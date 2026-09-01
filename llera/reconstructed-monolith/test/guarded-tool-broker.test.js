'use strict';
const assert = require('assert');
const { RESTORED_MONOLITH_TOOLS, ToolExecutionGuard } = require('../src/tool-surface');
const { MonolithCapabilityBroker } = require('../src/monolith-capability-broker');
const { GuardedMonolithToolBroker } = require('../src/guarded-tool-broker');

(async () => {
  assert.strictEqual(RESTORED_MONOLITH_TOOLS.length, 62);
  const calls = [];
  const authorizations = [];
  const historicalExecutor = async (tool,args) => {
    calls.push({tool,args});
    if (tool === 'write_file') return {written:args.path};
    if (tool === 'read_file') return {text:'verified bytes'};
    if (tool === 'list_dir') return ['a','b'];
    throw new Error(`mock missing:${tool}`);
  };
  const capabilityBroker = new MonolithCapabilityBroker({
    vision:{analyze:async x=>({vision:true,input:x.path||'image'}),ocrScreen:async()=>({text:'screen text'})},
    evidence:{record:async x=>({evidenceId:x.id||'ev-1'}),verify:async()=>({verified:true})},
    updater:{status:async()=>({state:'idle'})},
    hostguard:{snapshot:async()=>({pressure:'normal'})}
  });
  const broker = new GuardedMonolithToolBroker({
    historicalExecutor,
    capabilityBroker,
    guard:new ToolExecutionGuard(),
    actionAuthorizer:async request=>{authorizations.push(request);return {allow:true};}
  });
  const write = await broker.invoke('write_file',{path:'x.txt',text:'hello'});
  assert.strictEqual(write.ok,true);
  assert.strictEqual(write.canFinalize,false);
  assert.strictEqual(authorizations.length,1);
  assert.strictEqual(authorizations[0].tool,'write_file');
  const blocked = await broker.invoke('write_file',{path:'y.txt',text:'second'});
  assert.strictEqual(blocked.blocked,true);
  assert.strictEqual(blocked.reason,'verification_debt_open');
  const verify = await broker.invoke('read_file',{path:'x.txt'});
  assert.strictEqual(verify.ok,true);
  assert.strictEqual(verify.canFinalize,true);
  const vision = await broker.invoke('vision_analyze_image',{path:'screen.png'});
  assert.strictEqual(vision.ok,true);
  assert.strictEqual(vision.result.vision,true);
  const pressure = await broker.invoke('host_pressure_status');
  assert.strictEqual(pressure.ok,true);
  assert.strictEqual(pressure.result.pressure,'normal');
  const unknown = await broker.invoke('does_not_exist');
  assert.strictEqual(unknown.blocked,true);
  assert.strictEqual(unknown.reason,'unknown_tool');
  assert.strictEqual(calls.length >= 2,true);
  assert.strictEqual(broker.status().materialActionAuthorizationCoverageComplete,true);
  console.log('guarded MONOLITH broker PASS',{toolCount:RESTORED_MONOLITH_TOOLS.length,verificationDebtClosed:broker.status().canFinalize,specialCapabilities:6,allMaterialAuthorization:true});
})().catch(err=>{ console.error(err); process.exit(1); });
