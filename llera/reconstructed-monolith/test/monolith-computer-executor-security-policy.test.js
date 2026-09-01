'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const { MonolithComputerExecutor, isPrivateAddress } = require('../src/monolith-computer-executor');

function response({status=200,url='https://example.com/',body='ok',location=null}={}){
  return {
    status,
    ok:status>=200&&status<300,
    url,
    headers:{get(name){return String(name).toLowerCase()==='location'?location:null;}},
    async text(){return body;}
  };
}

(async()=>{
  const workspace=await fs.mkdtemp(path.join(os.tmpdir(),'llera-security-policy-'));
  try{
    const noAuthorizer=new MonolithComputerExecutor({workspaceRoot:workspace,allowOutsideWorkspace:true});
    assert(!noAuthorizer.coverage().available.includes('run_command'));
    assert(!noAuthorizer.coverage().available.includes('start_process'));
    await assert.rejects(()=>noAuthorizer.invoke('run_command',{command:'echo nope'}),/capability unavailable/);

    const denied=[];
    const controlled=new MonolithComputerExecutor({
      workspaceRoot:workspace,
      allowOutsideWorkspace:true,
      commandAuthorizer:async request=>{denied.push(request);return request.consequential===false;}
    });
    assert(controlled.coverage().available.includes('run_command'));
    const benign=await controlled.invoke('run_command',{command:`"${process.execPath}" -e "process.stdout.write('SAFE')"`});
    assert.strictEqual(benign.ok,true);
    assert.strictEqual(benign.stdout,'SAFE');
    await assert.rejects(()=>controlled.invoke('run_command',{command:'shutdown /s /t 0'}),/authorization required/);
    assert(denied.some(x=>x.consequential===true));
    await assert.rejects(()=>controlled.invoke('run_command',{command:'diskpart'}),/catastrophic command hard-blocked/);
    await assert.rejects(()=>controlled.invoke('run_command',{command:'vssadmin delete shadows /all'}),/catastrophic command hard-blocked/);

    const approveAll=new MonolithComputerExecutor({workspaceRoot:workspace,allowOutsideWorkspace:true,commandAuthorizer:async()=>true});
    await assert.rejects(()=>approveAll.invoke('run_command',{command:'format C:'}),/catastrophic command hard-blocked/);

    assert.strictEqual(isPrivateAddress('127.0.0.1'),true);
    assert.strictEqual(isPrivateAddress('10.1.2.3'),true);
    assert.strictEqual(isPrivateAddress('172.31.2.3'),true);
    assert.strictEqual(isPrivateAddress('192.168.1.2'),true);
    assert.strictEqual(isPrivateAddress('169.254.169.254'),true);
    assert.strictEqual(isPrivateAddress('8.8.8.8'),false);
    assert.strictEqual(isPrivateAddress('::1'),true);
    assert.strictEqual(isPrivateAddress('::ffff:172.16.1.1'),true);
    assert.strictEqual(isPrivateAddress('::ffff:169.254.169.254'),true);

    const publicExecutor=new MonolithComputerExecutor({
      workspaceRoot:workspace,
      dnsLookup:async(host)=>[{address:host==='public.example'?'93.184.216.34':'127.0.0.1',family:4}]
    });
    let bound=await publicExecutor._resolveBoundAddress('public.example');
    assert.strictEqual(bound.address,'93.184.216.34');
    await assert.rejects(()=>publicExecutor._resolveBoundAddress('internal.example'),/private network target blocked/);
    assert.throws(()=>publicExecutor._assertWebUrl('http://127.0.0.1:8080/'),/private network target blocked/);
    assert.throws(()=>publicExecutor._assertWebUrl('http://localhost/'),/private network target blocked/);
    assert.throws(()=>publicExecutor._assertWebUrl('http://user:pass@public.example/'),/credentials are not allowed/);

    const lookupError=await new Promise(resolve=>{
      const e=new MonolithComputerExecutor({workspaceRoot:workspace,dnsLookup:async()=>[{address:'169.254.169.254',family:4}]});
      e._boundLookup('metadata.example',{family:4},error=>resolve(error));
    });
    assert(lookupError);
    assert.match(String(lookupError.message||lookupError),/private network target blocked/);

    let requestCalls=0;
    const redirectExecutor=new MonolithComputerExecutor({workspaceRoot:workspace,dnsLookup:async()=>[{address:'93.184.216.34',family:4}]});
    redirectExecutor._requestWebOnce=async parsed=>{
      requestCalls+=1;
      if(requestCalls===1)return {status:302,ok:false,headers:{location:'http://169.254.169.254/latest/meta-data/'},url:parsed.toString(),text:''};
      throw new Error('private redirect must never reach transport');
    };
    await assert.rejects(()=>redirectExecutor.invoke('web_get',{url:'https://public.example/start'}),/private network target blocked/);
    assert.strictEqual(requestCalls,1,'redirect target must be rejected before second request');

    const publicFlow=new MonolithComputerExecutor({workspaceRoot:workspace,dnsLookup:async()=>[{address:'93.184.216.34',family:4}]});
    publicFlow._requestWebOnce=async parsed=>({status:200,ok:true,headers:{},url:parsed.toString(),text:'PUBLIC_OK'});
    const result=await publicFlow.invoke('web_get',{url:'https://public.example/path'});
    assert.strictEqual(result.ok,true);
    assert.strictEqual(result.text,'PUBLIC_OK');

    const privateOptIn=new MonolithComputerExecutor({workspaceRoot:workspace,allowPrivateNetwork:true});
    assert.strictEqual(privateOptIn._assertWebUrl('http://127.0.0.1/test').hostname,'127.0.0.1');

    console.log('MONOLITH computer executor security policy PASS',{
      shellRequiresAuthorizer:true,
      consequentialCommandRequiresApproval:true,
      catastrophicCommandHardBlocked:true,
      privateAndLinkLocalWebTargetsBlocked:true,
      privateDnsResolutionBlocked:true,
      redirectRevalidationBlocksPrivateTarget:true,
      privateNetworkRequiresExplicitOptIn:true
    });
  }finally{
    await fs.rm(workspace,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error.stack||error);process.exit(1);});
