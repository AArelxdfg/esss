'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const http = require('http');
const os = require('os');
const path = require('path');
const { MonolithComputerExecutor, PORTABLE_TOOLS, WORKSPACE_RESTRICTED_SHELL_TOOLS } = require('../src/monolith-computer-executor');

async function waitFor(fn,{timeout=3000,interval=20}={}){
  const until=Date.now()+timeout;
  while(Date.now()<until){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,interval));}
  throw new Error('waitFor timeout');
}

(async()=>{
  const workspace=await fsp.mkdtemp(path.join(os.tmpdir(),'llera-computer-executor-'));
  const outside=await fsp.mkdtemp(path.join(os.tmpdir(),'llera-computer-outside-'));
  let server=null;
  try{
    const executor=new MonolithComputerExecutor({workspaceRoot:workspace,processStopTimeoutMs:1000});
    const coverage=executor.coverage();
    for(const tool of PORTABLE_TOOLS){
      if(WORKSPACE_RESTRICTED_SHELL_TOOLS.has(tool)) assert(!coverage.available.includes(tool),`workspace-scoped shell must be unavailable: ${tool}`);
      else assert(coverage.available.includes(tool),`portable tool missing: ${tool}`);
    }
    assert.deepStrictEqual(coverage.blockedByWorkspacePolicy,[...WORKSPACE_RESTRICTED_SHELL_TOOLS].sort());
    await assert.rejects(()=>executor.invoke('run_command',{command:'echo SHOULD_NOT_RUN'}),/capability unavailable/);
    await assert.rejects(()=>executor.invoke('start_process',{command:'echo SHOULD_NOT_RUN'}),/capability unavailable/);
    for(const tool of ['browser_click','ui_snapshot','clipboard_read','web_search','search_cyber_core'])assert(!coverage.available.includes(tool),`${tool} must be unavailable without adapter`);

    await assert.rejects(()=>executor.invoke('read_file',{path:'../outside.txt'}),/workspace path escape blocked/);
    const secret=path.join(outside,'secret.txt');await fsp.writeFile(secret,'outside');
    const link=path.join(workspace,'escape-link');
    try{
      await fsp.symlink(outside,link,'dir');
      await assert.rejects(()=>executor.invoke('read_file',{path:'escape-link/secret.txt'}),/workspace symlink escape blocked/);
    }catch(error){
      if(!['EPERM','EACCES','ENOTSUP'].includes(error && error.code))throw error;
    }

    let result=await executor.invoke('write_file',{path:'a/hello.txt',content:'alpha\nbeta\ngamma'});
    assert.strictEqual(result.ok,true);
    assert.strictEqual(result.sha256,crypto.createHash('sha256').update('alpha\nbeta\ngamma').digest('hex'));

    result=await executor.invoke('read_file',{path:'a/hello.txt'});
    assert.strictEqual(result.text,'alpha\nbeta\ngamma');
    assert.strictEqual(result.truncated,false);

    result=await executor.invoke('read_text_range',{path:'a/hello.txt',start_line:2,end_line:3});
    assert.strictEqual(result.text,'beta\ngamma');
    assert.strictEqual(result.startLine,2);
    assert.strictEqual(result.endLine,3);

    result=await executor.invoke('apply_patch',{path:'a/hello.txt',find:'beta',replace:'BETA'});
    assert.strictEqual(result.ok,true);
    assert.strictEqual((await fsp.readFile(path.join(workspace,'a/hello.txt'),'utf8')),'alpha\nBETA\ngamma');

    result=await executor.invoke('hash_file',{path:'a/hello.txt'});
    assert.strictEqual(result.sha256,crypto.createHash('sha256').update('alpha\nBETA\ngamma').digest('hex'));
    result=await executor.invoke('file_stat',{path:'a/hello.txt'});assert.strictEqual(result.isFile,true);
    result=await executor.invoke('path_exists',{path:'a/hello.txt'});assert.strictEqual(result.exists,true);

    await executor.invoke('make_dir',{path:'dest'});
    await executor.invoke('copy_path',{source:'a/hello.txt',destination:'dest/copied.txt'});
    assert.strictEqual(await fsp.readFile(path.join(workspace,'dest/copied.txt'),'utf8'),'alpha\nBETA\ngamma');
    await executor.invoke('move_path',{source:'dest/copied.txt',destination:'dest/moved.txt'});
    assert.strictEqual(fs.existsSync(path.join(workspace,'dest/copied.txt')),false);
    assert.strictEqual(fs.existsSync(path.join(workspace,'dest/moved.txt')),true);

    result=await executor.invoke('search_files',{root:'.',query:'BETA',content:true});
    assert(result.results.some(x=>x.path.endsWith(path.join('a','hello.txt'))&&x.match==='content'));
    result=await executor.invoke('list_dir',{path:'dest'});assert(result.entries.some(x=>x.name==='moved.txt'));
    await executor.invoke('delete_path',{path:'dest/moved.txt'});
    assert.strictEqual(fs.existsSync(path.join(workspace,'dest/moved.txt')),false);
    await assert.rejects(()=>executor.invoke('delete_path',{path:'.',recursive:true}),/workspace root deletion blocked/);

    const fullExecutor=new MonolithComputerExecutor({workspaceRoot:workspace,allowOutsideWorkspace:true,processStopTimeoutMs:1000});
    assert(fullExecutor.coverage().available.includes('run_command'));
    assert(fullExecutor.coverage().available.includes('start_process'));

    result=await fullExecutor.invoke('run_command',{command:`"${process.execPath}" -e "process.stdout.write('RUN_OK')"`,shell:'system',cwd:'.'});
    assert.strictEqual(result.ok,true);assert.strictEqual(result.stdout,'RUN_OK');assert.strictEqual(result.exitCode,0);
    result=await fullExecutor.invoke('run_command',{command:`"${process.execPath}" -e "process.stderr.write('NOPE');process.exit(7)"`,shell:'system',cwd:'.'});
    assert.strictEqual(result.ok,false);assert.strictEqual(result.exitCode,7);assert.strictEqual(result.stderr,'NOPE');

    const shortJob=await fullExecutor.invoke('start_process',{command:`"${process.execPath}" -e "setTimeout(()=>process.stdout.write('BG_OK'),80)"`,shell:'system',cwd:'.'});
    const completed=await waitFor(async()=>{const state=await fullExecutor.invoke('process_status',{job_id:shortJob.jobId});return state.state==='completed'?state:null;});
    assert.strictEqual(completed.stdout,'BG_OK');
    result=await fullExecutor.invoke('read_process_output',{job_id:shortJob.jobId});assert.strictEqual(result.stdout,'BG_OK');

    const longJob=await fullExecutor.invoke('start_process',{command:`"${process.execPath}" -e "setInterval(()=>{},1000)"`,shell:'system',cwd:'.'});
    const stopped=await fullExecutor.invoke('process_stop',{job_id:longJob.jobId});
    assert.strictEqual(stopped.state,'stopped');

    result=await executor.invoke('list_processes',{});assert.strictEqual(result.ok,true);assert(result.text.length>0);
    result=await executor.invoke('system_info',{});assert.strictEqual(result.ok,true);assert.strictEqual(result.workspaceRoot,workspace);

    server=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/plain'});res.end('LOCAL_HTTP_OK');});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const addr=server.address();
    result=await executor.invoke('web_get',{url:`http://127.0.0.1:${addr.port}/test`});
    assert.strictEqual(result.ok,true);assert.strictEqual(result.text,'LOCAL_HTTP_OK');

    const adapterCalls=[];
    const adapters=new MonolithComputerExecutor({
      workspaceRoot:workspace,
      computerAdapter:{
        uiSnapshot:async(args)=>{adapterCalls.push(['ui',args]);return {ok:true,controls:[]};},
        clipboardRead:async(args)=>{adapterCalls.push(['clipboard',args]);return {ok:true,text:'clip'};}
      },
      browserAdapter:{click:async(args)=>{adapterCalls.push(['browser',args]);return {ok:true,clicked:true};}},
      webSearch:async(args)=>{adapterCalls.push(['search',args]);return {ok:true,results:[]};},
      cyberSearch:async(args)=>{adapterCalls.push(['cyber',args]);return {ok:true,hits:[]};}
    });
    const adapterCoverage=adapters.coverage();
    for(const tool of ['ui_snapshot','clipboard_read','browser_click','web_search','search_cyber_core'])assert(adapterCoverage.available.includes(tool));
    assert.strictEqual((await adapters.invoke('ui_snapshot',{title_or_process:'x'})).ok,true);
    assert.strictEqual((await adapters.invoke('browser_click',{target:'x'})).clicked,true);
    assert.strictEqual((await adapters.invoke('web_search',{query:'x'})).ok,true);
    assert.strictEqual((await adapters.invoke('search_cyber_core',{query:'x'})).ok,true);
    await assert.rejects(()=>adapters.invoke('browser_open',{url:'https://example.com'}),/capability unavailable/);
    assert.strictEqual(adapterCalls.length,4);

    console.log('MONOLITH concrete computer executor PASS',{
      portableTools:PORTABLE_TOOLS.size,
      filesystemReadWriteVerify:true,
      workspaceEscapeBlocked:true,
      workspaceScopedShellFailClosed:true,
      fullPcShellRequiresExplicitOptIn:true,
      processRunBackgroundStop:true,
      localHttpWebGet:true,
      missingAdaptersFailClosed:true,
      adapterCoverageExplicit:true
    });
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    await fsp.rm(workspace,{recursive:true,force:true});
    await fsp.rm(outside,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error.stack||error);process.exit(1);});
