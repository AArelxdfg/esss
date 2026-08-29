'use strict';

const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const dns = require('dns').promises;
const http = require('http');
const https = require('https');
const net = require('net');
const { spawn } = require('child_process');

const PORTABLE_TOOLS = new Set([
  'list_dir','read_file','write_file','apply_patch','search_files','make_dir','copy_path','move_path','delete_path',
  'run_command','start_process','process_status','process_stop','read_process_output','list_processes',
  'read_text_range','file_stat','path_exists','hash_file','web_get','system_info'
]);

// Generic shell commands cannot be proven workspace-confined by cwd alone.
// In workspace-scoped mode they are fail-closed; full-PC mode must be explicit.
const WORKSPACE_RESTRICTED_SHELL_TOOLS = new Set(['run_command','start_process']);
const HARD_BLOCKED_COMMAND_PATTERNS = [
  /(^|[;&|\s])(?:rm\s+-[^\n]*r[^\n]*f|rm\s+-[^\n]*f[^\n]*r)\s+\/(?:\s|$|[*])/i,
  /(^|[;&|\s])(?:mkfs(?:\.[a-z0-9]+)?|wipefs)\b/i,
  /(^|[;&|\s])dd\b[^\n]*\bof=\/dev\//i,
  /\b(?:vssadmin\s+delete\s+shadows|wmic\s+shadowcopy\s+delete)\b/i,
  /\bbcdedit\b[^\n]*\/(?:delete|deletevalue|createstore)\b/i,
  /\bformat(?:\.com)?\s+[a-z]:/i,
  /\bdiskpart\b/i
];
const CONSEQUENT_COMMAND_PATTERNS = [
  /\b(?:shutdown|reboot|restart-computer|stop-computer)\b/i,
  /\b(?:remove-item|del|erase|rmdir|rd)\b/i,
  /\b(?:reg\s+(?:delete|add)|set-itemproperty|new-itemproperty|remove-itemproperty)\b/i,
  /\b(?:sc(?:\.exe)?\s+(?:delete|config|stop)|stop-service|remove-service)\b/i
];

const COMPUTER_ADAPTER_METHODS = {
  list_apps:'listApps', launch_app:'launchApp', focus_app:'focusApp', ui_snapshot:'uiSnapshot', ui_invoke:'uiInvoke',
  close_app:'closeApp', desktop_screenshot:'desktopScreenshot', mouse_click:'mouseClick', keyboard_type:'keyboardType',
  key_press:'keyPress', clipboard_read:'clipboardRead', clipboard_write:'clipboardWrite', window_list:'windowList',
  window_move_resize:'windowMoveResize'
};

const BROWSER_ADAPTER_METHODS = {
  browser_open:'open', browser_google:'google', browser_snapshot:'snapshot', browser_click:'click', browser_type:'type',
  browser_back:'back', browser_show:'show', browser_reload:'reload', browser_close:'close', browser_extract:'extract',
  browser_download:'download'
};

function normalizeToolArgs(args) { return args && typeof args === 'object' ? args : {}; }
function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
function capText(value, max = 2 * 1024 * 1024) {
  const text = String(value == null ? '' : value);
  if (Buffer.byteLength(text) <= max) return text;
  return Buffer.from(text).subarray(0, max).toString('utf8') + '\n[LLera: output truncated]';
}
function sha256Bytes(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

function isIpLiteral(host) {
  return net.isIP(String(host || '').replace(/^\[|\]$/g,'')) !== 0;
}
function ipv4Number(ip) {
  const parts=ip.split('.').map(Number);
  if(parts.length!==4 || parts.some(n=>!Number.isInteger(n)||n<0||n>255))return null;
  return (((parts[0]<<24)>>>0)+(parts[1]<<16)+(parts[2]<<8)+parts[3])>>>0;
}
function inIpv4Range(ip, base, bits) {
  const n=ipv4Number(ip), b=ipv4Number(base); if(n===null||b===null)return false;
  const mask=bits===0?0:(0xffffffff << (32-bits))>>>0; return (n&mask)===(b&mask);
}
function isPrivateAddress(address) {
  let ip=String(address||'').toLowerCase().replace(/^\[|\]$/g,'');
  const mapped=ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if(mapped) ip=mapped[1];
  if(ip.includes(':')){
    return ip==='::1'||ip==='::'||ip.startsWith('fc')||ip.startsWith('fd')||/^fe[89ab]/.test(ip);
  }
  return inIpv4Range(ip,'0.0.0.0',8)||inIpv4Range(ip,'10.0.0.0',8)||inIpv4Range(ip,'100.64.0.0',10)||inIpv4Range(ip,'127.0.0.0',8)||inIpv4Range(ip,'169.254.0.0',16)||inIpv4Range(ip,'172.16.0.0',12)||inIpv4Range(ip,'192.0.0.0',24)||inIpv4Range(ip,'192.168.0.0',16)||inIpv4Range(ip,'198.18.0.0',15)||inIpv4Range(ip,'224.0.0.0',4)||inIpv4Range(ip,'240.0.0.0',4);
}
async function resolveAddresses(lookup, host) {
  if(typeof lookup!=='function')throw new Error('dns lookup unavailable');
  const result=await lookup(host,{all:true,verbatim:true});
  if(Array.isArray(result))return result.map(x=>typeof x==='string'?x:x.address).filter(Boolean);
  if(result&&result.address)return [result.address];
  if(typeof result==='string')return [result];
  return [];
}

class MonolithComputerExecutor {
  constructor({
    workspaceRoot = process.cwd(),
    allowOutsideWorkspace = false,
    computerAdapter = null,
    browserAdapter = null,
    webSearch = null,
    cyberSearch = null,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    maxReadBytes = 4 * 1024 * 1024,
    maxOutputBytes = 2 * 1024 * 1024,
    maxSearchFiles = 5000,
    processStopTimeoutMs = 5000,
    commandAuthorizer = null,
    allowPrivateNetwork = false,
    dnsLookup = dns.lookup,
    maxRedirects = 5
  } = {}) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.allowOutsideWorkspace = Boolean(allowOutsideWorkspace);
    this.computerAdapter = computerAdapter;
    this.browserAdapter = browserAdapter;
    this.webSearch = webSearch;
    this.cyberSearch = cyberSearch;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.maxReadBytes = maxReadBytes;
    this.maxOutputBytes = maxOutputBytes;
    this.maxSearchFiles = maxSearchFiles;
    this.processStopTimeoutMs = processStopTimeoutMs;
    this.commandAuthorizer = commandAuthorizer;
    this.allowPrivateNetwork = Boolean(allowPrivateNetwork);
    this.dnsLookup = dnsLookup;
    this.maxRedirects = Math.min(10, Math.max(0, Number(maxRedirects) || 0));
    this.jobs = new Map();
    fs.mkdirSync(this.workspaceRoot, {recursive:true});
    this.workspaceReal = fs.realpathSync(this.workspaceRoot);
  }

  coverage() {
    const available = new Set(PORTABLE_TOOLS);
    const blockedByWorkspacePolicy = [];
    if (!this.allowOutsideWorkspace || typeof this.commandAuthorizer !== 'function') {
      for (const tool of WORKSPACE_RESTRICTED_SHELL_TOOLS) {
        available.delete(tool);
        blockedByWorkspacePolicy.push(tool);
      }
    }
    for (const [tool, method] of Object.entries(COMPUTER_ADAPTER_METHODS)) {
      if (this.computerAdapter && typeof this.computerAdapter[method] === 'function') available.add(tool);
    }
    for (const [tool, method] of Object.entries(BROWSER_ADAPTER_METHODS)) {
      if (this.browserAdapter && typeof this.browserAdapter[method] === 'function') available.add(tool);
    }
    if (typeof this.webSearch === 'function') available.add('web_search');
    if (typeof this.cyberSearch === 'function') available.add('search_cyber_core');
    return {
      available:[...available].sort(),
      unavailable:[...blockedByWorkspacePolicy].sort(),
      blockedByWorkspacePolicy:[...blockedByWorkspacePolicy].sort(),
      portable:[...PORTABLE_TOOLS].sort(),
      adapterBacked:[...available].filter(t => !PORTABLE_TOOLS.has(t)).sort(),
      availableCount:available.size
    };
  }

  async invoke(tool, rawArgs = {}, context = {}) {
    const args = normalizeToolArgs(rawArgs);
    if (!this.coverage().available.includes(tool)) throw new Error(`computer executor capability unavailable: ${tool}`);

    switch (tool) {
      case 'list_dir': return this.listDir(args);
      case 'read_file': return this.readFile(args);
      case 'write_file': return this.writeFile(args);
      case 'apply_patch': return this.applyPatch(args);
      case 'search_files': return this.searchFiles(args);
      case 'make_dir': return this.makeDir(args);
      case 'copy_path': return this.copyPath(args);
      case 'move_path': return this.movePath(args);
      case 'delete_path': return this.deletePath(args);
      case 'read_text_range': return this.readTextRange(args);
      case 'file_stat': return this.fileStat(args);
      case 'path_exists': return this.pathExists(args);
      case 'hash_file': return this.hashFile(args);
      case 'run_command': return this.runCommand(args, context);
      case 'start_process': return this.startProcess(args, context);
      case 'process_status': return this.processStatus(args);
      case 'process_stop': return this.processStop(args);
      case 'read_process_output': return this.readProcessOutput(args);
      case 'list_processes': return this.listProcesses(args);
      case 'web_get': return this.webGet(args);
      case 'web_search': return this.webSearch(args, context);
      case 'search_cyber_core': return this.cyberSearch(args, context);
      case 'system_info': return this.systemInfo();
      default: break;
    }

    if (Object.prototype.hasOwnProperty.call(COMPUTER_ADAPTER_METHODS, tool)) {
      return this.computerAdapter[COMPUTER_ADAPTER_METHODS[tool]](args, context);
    }
    if (Object.prototype.hasOwnProperty.call(BROWSER_ADAPTER_METHODS, tool)) {
      return this.browserAdapter[BROWSER_ADAPTER_METHODS[tool]](args, context);
    }
    throw new Error(`computer executor capability unavailable: ${tool}`);
  }

  resolvePath(value, {forCreate = false} = {}) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('path is required');
    const target = path.resolve(this.workspaceRoot, value);
    if (this.allowOutsideWorkspace) return target;
    if (!isInside(this.workspaceRoot, target)) throw new Error(`workspace path escape blocked: ${value}`);

    let probe = forCreate ? path.dirname(target) : target;
    while (!fs.existsSync(probe)) {
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
    if (fs.existsSync(probe)) {
      const real = fs.realpathSync(probe);
      if (!isInside(this.workspaceReal, real)) throw new Error(`workspace symlink escape blocked: ${value}`);
    }
    if (fs.existsSync(target)) {
      const realTarget = fs.realpathSync(target);
      if (!isInside(this.workspaceReal, realTarget)) throw new Error(`workspace symlink escape blocked: ${value}`);
    }
    return target;
  }

  async listDir(args) {
    const target = this.resolvePath(args.path || '.');
    const entries = await fsp.readdir(target,{withFileTypes:true});
    return {ok:true,path:target,entries:entries.slice(0,1000).map(e=>({name:e.name,type:e.isDirectory()?'directory':e.isFile()?'file':e.isSymbolicLink()?'symlink':'other'})),truncated:entries.length>1000};
  }

  async readFile(args) {
    const target = this.resolvePath(args.path);
    const stat = await fsp.stat(target);
    if (!stat.isFile()) throw new Error('read_file target is not a file');
    const limit = Math.min(this.maxReadBytes, Math.max(1, Number(args.max_bytes || args.max_chars || this.maxReadBytes)));
    const fh = await fsp.open(target,'r');
    try {
      const bytes = Buffer.alloc(Math.min(stat.size,limit));
      const {bytesRead} = await fh.read(bytes,0,bytes.length,0);
      return {ok:true,path:target,text:bytes.subarray(0,bytesRead).toString('utf8'),bytesRead,fileBytes:stat.size,truncated:stat.size>bytesRead};
    } finally { await fh.close(); }
  }

  async writeFile(args) {
    const target = this.resolvePath(args.path,{forCreate:true});
    const content = String(args.content == null ? '' : args.content);
    await fsp.mkdir(path.dirname(target),{recursive:true});
    await fsp.writeFile(target,content,'utf8');
    const readback = await fsp.readFile(target);
    if (!readback.equals(Buffer.from(content,'utf8'))) throw new Error('write/readback verification failed');
    return {ok:true,path:target,bytes:readback.length,sha256:sha256Bytes(readback)};
  }

  async applyPatch(args) {
    const target = this.resolvePath(args.path);
    const before = await fsp.readFile(target,'utf8');
    const find = String(args.find == null ? '' : args.find);
    if (!find) throw new Error('apply_patch find is required');
    if (!before.includes(find)) throw new Error('apply_patch find text not found');
    const replacement = String(args.replace == null ? '' : args.replace);
    const after = args.all ? before.split(find).join(replacement) : before.replace(find,replacement);
    if (after === before) throw new Error('apply_patch made no change');
    await fsp.writeFile(target,after,'utf8');
    const readback = await fsp.readFile(target,'utf8');
    if (readback !== after) throw new Error('apply_patch readback verification failed');
    return {ok:true,path:target,replacements:args.all ? before.split(find).length - 1 : 1,sha256:sha256Bytes(Buffer.from(readback))};
  }

  async searchFiles(args) {
    const root = this.resolvePath(args.root || '.');
    const query = String(args.query || '').toLowerCase();
    if (!query) throw new Error('search_files query is required');
    const maxResults = Math.min(500,Math.max(1,Number(args.max_results)||100));
    const contentSearch = Boolean(args.content);
    const results=[];
    let visited=0;
    const stack=[root];
    while(stack.length && results.length<maxResults && visited<this.maxSearchFiles){
      const dir=stack.pop();
      let entries;
      try{entries=await fsp.readdir(dir,{withFileTypes:true});}catch{continue;}
      for(const entry of entries){
        if(results.length>=maxResults||visited>=this.maxSearchFiles)break;
        visited += 1;
        const full=path.join(dir,entry.name);
        if(entry.isSymbolicLink())continue;
        if(entry.isDirectory()){stack.push(full);continue;}
        if(!entry.isFile())continue;
        const rel=path.relative(root,full);
        if(entry.name.toLowerCase().includes(query)||rel.toLowerCase().includes(query)){results.push({path:full,match:'name'});continue;}
        if(contentSearch){
          try{
            const stat=await fsp.stat(full);if(stat.size>this.maxReadBytes)continue;
            const text=await fsp.readFile(full,'utf8');
            const at=text.toLowerCase().indexOf(query);
            if(at>=0)results.push({path:full,match:'content',excerpt:text.slice(Math.max(0,at-100),at+query.length+100)});
          }catch{}
        }
      }
    }
    return {ok:true,root,query,results,visited,truncated:Boolean(stack.length||visited>=this.maxSearchFiles||results.length>=maxResults)};
  }

  async makeDir(args) {
    const target=this.resolvePath(args.path,{forCreate:true});
    await fsp.mkdir(target,{recursive:true});
    const stat=await fsp.stat(target);if(!stat.isDirectory())throw new Error('directory creation verification failed');
    return {ok:true,path:target};
  }

  async copyPath(args) {
    const source=this.resolvePath(args.source);const destination=this.resolvePath(args.destination,{forCreate:true});
    const stat=await fsp.stat(source);await fsp.mkdir(path.dirname(destination),{recursive:true});
    if(stat.isDirectory()) await fsp.cp(source,destination,{recursive:true,errorOnExist:false,force:true});
    else if(stat.isFile()) await fsp.copyFile(source,destination);
    else throw new Error('copy_path supports files/directories only');
    const dst=await fsp.stat(destination);
    if(stat.isFile()&&(!dst.isFile()||dst.size!==stat.size))throw new Error('copy verification failed');
    if(stat.isFile()){
      const [a,b]=await Promise.all([fsp.readFile(source),fsp.readFile(destination)]);
      if(sha256Bytes(a)!==sha256Bytes(b))throw new Error('copy sha256 verification failed');
    }
    return {ok:true,source,destination};
  }

  async movePath(args) {
    const source=this.resolvePath(args.source);const destination=this.resolvePath(args.destination,{forCreate:true});
    await fsp.mkdir(path.dirname(destination),{recursive:true});
    try{await fsp.rename(source,destination);}catch(error){if(error && error.code==='EXDEV'){await fsp.cp(source,destination,{recursive:true,force:true});await fsp.rm(source,{recursive:true,force:false});}else throw error;}
    if(fs.existsSync(source)||!fs.existsSync(destination))throw new Error('move verification failed');
    return {ok:true,source,destination};
  }

  async deletePath(args) {
    const target=this.resolvePath(args.path);
    if(target===this.workspaceRoot)throw new Error('workspace root deletion blocked');
    await fsp.rm(target,{recursive:Boolean(args.recursive),force:false});
    if(fs.existsSync(target))throw new Error('delete verification failed');
    return {ok:true,path:target,deleted:true};
  }

  async readTextRange(args) {
    const target=this.resolvePath(args.path);
    const stat=await fsp.stat(target);if(!stat.isFile())throw new Error('read_text_range target is not a file');
    if(stat.size>this.maxReadBytes)throw new Error('read_text_range file exceeds configured limit');
    const lines=(await fsp.readFile(target,'utf8')).split(/\r?\n/);
    const start=Math.max(1,Number(args.start_line||args.start||1));
    const end=Math.min(lines.length,Math.max(start,Number(args.end_line||args.end||start+199)));
    return {ok:true,path:target,startLine:start,endLine:end,totalLines:lines.length,text:lines.slice(start-1,end).join('\n')};
  }

  async fileStat(args) {
    const target=this.resolvePath(args.path);const stat=await fsp.lstat(target);
    return {ok:true,path:target,size:stat.size,isFile:stat.isFile(),isDirectory:stat.isDirectory(),isSymbolicLink:stat.isSymbolicLink(),mtimeMs:stat.mtimeMs,mode:stat.mode};
  }

  async pathExists(args) {
    let target;
    try{target=this.resolvePath(args.path,{forCreate:true});}catch(error){return {ok:false,exists:false,error:String(error.message||error)};}
    return {ok:true,path:target,exists:fs.existsSync(target)};
  }

  async hashFile(args) {
    const target=this.resolvePath(args.path);const stat=await fsp.stat(target);if(!stat.isFile())throw new Error('hash_file target is not a file');
    const hash=crypto.createHash('sha256');
    await new Promise((resolve,reject)=>{const stream=fs.createReadStream(target);stream.on('data',chunk=>hash.update(chunk));stream.on('end',resolve);stream.on('error',reject);});
    return {ok:true,path:target,sha256:hash.digest('hex'),bytes:stat.size};
  }

  async assertCommandAllowed(args, context = {}) {
    const command = String(args.command || args.cmd || '');
    if (!command) throw new Error('command is required');
    if (HARD_BLOCKED_COMMAND_PATTERNS.some(pattern => pattern.test(command))) {
      throw new Error('catastrophic command hard-blocked');
    }
    const consequential = CONSEQUENT_COMMAND_PATTERNS.some(pattern => pattern.test(command));
    if (typeof this.commandAuthorizer !== 'function') throw new Error('command authorizer unavailable');
    const decision = await this.commandAuthorizer({command, args:{...args}, consequential, context});
    if (decision !== true && !(decision && decision.allow === true)) {
      throw new Error(consequential ? 'consequential command authorization required' : 'command authorization denied');
    }
    return {command, consequential};
  }

  commandSpec(args) {
    const command=String(args.command||args.cmd||'');if(!command)throw new Error('command is required');
    const shell=String(args.shell||'system').toLowerCase();
    if(shell==='powershell')return {file:process.platform==='win32'?'powershell.exe':'pwsh',argv:['-NoProfile','-NonInteractive','-Command',command]};
    if(shell==='cmd')return {file:process.platform==='win32'?'cmd.exe':'sh',argv:process.platform==='win32'?['/d','/s','/c',command]:['-lc',command]};
    if(shell==='wsl')return {file:'wsl.exe',argv:['--','bash','-lc',command]};
    return process.platform==='win32'?{file:'powershell.exe',argv:['-NoProfile','-NonInteractive','-Command',command]}:{file:'/bin/sh',argv:['-lc',command]};
  }

  async runCommand(args, context = {}) {
    await this.assertCommandAllowed(args, context);
    const cwd=this.resolvePath(args.cwd||'.');const spec=this.commandSpec(args);const timeoutMs=Math.min(20*60*1000,Math.max(100,Number(args.timeout_ms||args.timeoutMs||120000)));
    return new Promise((resolve,reject)=>{
      const child=spawn(spec.file,spec.argv,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});
      let stdout='',stderr='',settled=false,timedOut=false;
      const append=(which,chunk)=>{const next=capText((which==='out'?stdout:stderr)+chunk,this.maxOutputBytes);if(which==='out')stdout=next;else stderr=next;};
      child.stdout.on('data',c=>append('out',c));child.stderr.on('data',c=>append('err',c));
      child.once('error',error=>{if(settled)return;settled=true;clearTimeout(timer);reject(error);});
      child.once('close',(code,signal)=>{if(settled)return;settled=true;clearTimeout(timer);resolve({ok:code===0&&!timedOut,exitCode:code,signal,timedOut,stdout,stderr,pid:child.pid});});
      const timer=setTimeout(()=>{if(settled)return;timedOut=true;try{child.kill('SIGKILL');}catch{}},timeoutMs);
    });
  }

  async startProcess(args, context = {}) {
    await this.assertCommandAllowed(args, context);
    const cwd=this.resolvePath(args.cwd||'.');const spec=this.commandSpec(args);const id=crypto.randomUUID();
    const child=spawn(spec.file,spec.argv,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const job={id,pid:child.pid,command:String(args.command||args.cmd||''),cwd,state:'running',exitCode:null,signal:null,stdout:'',stderr:'',startedAt:this.now(),endedAt:null,child};
    this.jobs.set(id,job);
    const append=(field,chunk)=>{job[field]=capText(job[field]+chunk,this.maxOutputBytes);};
    child.stdout.on('data',c=>append('stdout',c));child.stderr.on('data',c=>append('stderr',c));
    child.once('error',error=>{job.state='failed';job.stderr=capText(job.stderr+String(error.message||error),this.maxOutputBytes);job.endedAt=this.now();});
    child.once('close',(code,signal)=>{job.exitCode=code;job.signal=signal;job.state=job.state==='stopping'?'stopped':code===0?'completed':'failed';job.endedAt=this.now();});
    return this.jobView(job);
  }

  jobView(job) { return {ok:job.state!=='failed',jobId:job.id,pid:job.pid,state:job.state,exitCode:job.exitCode,signal:job.signal,stdout:job.stdout,stderr:job.stderr,startedAt:job.startedAt,endedAt:job.endedAt}; }
  jobFromArgs(args) { const id=String(args.job_id||args.jobId||'');const job=this.jobs.get(id);if(!job)throw new Error(`unknown process job: ${id}`);return job; }
  async processStatus(args) { return this.jobView(this.jobFromArgs(args)); }
  async readProcessOutput(args) { const job=this.jobFromArgs(args);return {ok:job.state!=='failed',jobId:job.id,state:job.state,stdout:job.stdout,stderr:job.stderr,exitCode:job.exitCode}; }

  async processStop(args) {
    const job=this.jobFromArgs(args);if(['completed','failed','stopped'].includes(job.state))return {...this.jobView(job),alreadyExited:true};
    job.state='stopping';
    try{job.child.kill(args.signal||'SIGTERM');}catch(error){job.state='failed';throw error;}
    const deadline=this.now()+this.processStopTimeoutMs;
    while(job.state==='stopping'&&this.now()<deadline)await new Promise(r=>setTimeout(r,20));
    if(job.state==='stopping'){
      try{job.child.kill('SIGKILL');}catch{}
      await new Promise(r=>setTimeout(r,50));
    }
    if(job.state==='stopping')throw new Error(`process_stop timeout for job ${job.id}`);
    return this.jobView(job);
  }

  async listProcesses() {
    const spec=process.platform==='win32'?{file:'tasklist.exe',argv:['/FO','CSV','/NH']}:{file:'ps',argv:['-eo','pid=,ppid=,comm=']};
    const output=await new Promise((resolve,reject)=>{
      const child=spawn(spec.file,spec.argv,{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';
      child.stdout.on('data',c=>out=capText(out+c,this.maxOutputBytes));child.stderr.on('data',c=>err=capText(err+c,this.maxOutputBytes));
      child.once('error',reject);child.once('close',code=>code===0?resolve(out):reject(new Error(`process list failed: ${err}`)));
    });
    return {ok:true,platform:process.platform,text:output,managedJobs:[...this.jobs.values()].map(j=>this.jobView(j))};
  }

  _assertWebUrl(url) {
    const parsed = new URL(String(url));
    if (!['http:','https:'].includes(parsed.protocol)) throw new Error('web_get requires http/https URL');
    if (parsed.username || parsed.password) throw new Error('web_get URL credentials are not allowed');
    if (this.allowPrivateNetwork) return parsed;
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost')) throw new Error('web_get private network target blocked');
    if (isIpLiteral(host) && isPrivateAddress(host)) throw new Error('web_get private network target blocked');
    return parsed;
  }

  async _resolveBoundAddress(hostname, family = 0) {
    const addresses = isIpLiteral(hostname) ? [hostname] : await resolveAddresses(this.dnsLookup, hostname);
    if (!addresses.length) throw new Error('web_get hostname resolution returned no addresses');
    if (!this.allowPrivateNetwork && addresses.some(isPrivateAddress)) throw new Error('web_get private network target blocked');
    const requestedFamily = Number(family) || 0;
    const selected = addresses.map(address => ({address, family:net.isIP(address)})).find(item => !requestedFamily || item.family === requestedFamily);
    if (!selected || !selected.family) throw new Error('web_get hostname resolution returned invalid address');
    return selected;
  }

  _boundLookup(hostname, options, callback) {
    const family = typeof options === 'number' ? options : Number(options && options.family) || 0;
    this._resolveBoundAddress(hostname, family).then(
      selected => callback(null, selected.address, selected.family),
      error => callback(error)
    );
  }

  async _requestWebOnce(parsed, timeoutMs) {
    const client = parsed.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const options = {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
        headers: {'user-agent':'LLera-MONOLITH/1.0','accept-encoding':'identity'},
        lookup: (hostname, lookupOptions, callback) => this._boundLookup(hostname, lookupOptions, callback)
      };
      const req = client.request(options, response => {
        const chunks=[]; let total=0; let settled=false;
        response.on('data', chunk => {
          if(settled)return;
          total += chunk.length;
          if(total > this.maxReadBytes){
            settled=true;
            req.destroy(new Error('web_get response exceeds configured limit'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if(settled)return; settled=true;
          resolve({
            status:Number(response.statusCode||0),
            ok:Number(response.statusCode||0)>=200&&Number(response.statusCode||0)<300,
            headers:response.headers||{},
            url:parsed.toString(),
            text:Buffer.concat(chunks).toString('utf8')
          });
        });
        response.on('error', reject);
      });
      req.once('error', reject);
      req.setTimeout(timeoutMs, () => req.destroy(new Error('web_get timeout')));
      req.end();
    });
  }

  async webGet(args) {
    let url=String(args.url||'');
    const timeoutMs=Math.min(120000,Math.max(100,Number(args.timeout_ms||30000)));
    for(let redirectCount=0; redirectCount<=this.maxRedirects; redirectCount+=1){
      const parsed=this._assertWebUrl(url);
      const response=await this._requestWebOnce(parsed,timeoutMs);
      if([301,302,303,307,308].includes(response.status)){
        if(redirectCount===this.maxRedirects)throw new Error('web_get redirect limit exceeded');
        const location=response.headers.location;
        if(!location)throw new Error('web_get redirect missing location');
        url=new URL(location,parsed).toString();
        continue;
      }
      return {...response,redirects:redirectCount};
    }
    throw new Error('web_get redirect limit exceeded');
  }

  systemInfo() {
    return {ok:true,platform:process.platform,arch:process.arch,hostname:os.hostname(),cpus:os.cpus().length,totalMemory:os.totalmem(),freeMemory:os.freemem(),uptime:os.uptime(),node:process.version,workspaceRoot:this.workspaceRoot};
  }
}

module.exports = { PORTABLE_TOOLS, WORKSPACE_RESTRICTED_SHELL_TOOLS, HARD_BLOCKED_COMMAND_PATTERNS, CONSEQUENT_COMMAND_PATTERNS, isPrivateAddress, COMPUTER_ADAPTER_METHODS, BROWSER_ADAPTER_METHODS, MonolithComputerExecutor };
