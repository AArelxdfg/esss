'use strict';

const assert = require('assert');
const Module = require('module');

const restored = ['read_file','delete_path','process_stop','browser_click','snapshot_restore','evidence_verify'];
const material = new Set(['delete_path','process_stop','browser_click','snapshot_restore']);
class FakeGuard {
  constructor(){ this.verificationDebt=null; this.records=[]; }
  decide(tool,args){
    if(!restored.includes(tool))return {allow:false,reason:'unknown_tool'};
    return {allow:true,fingerprint:`fp:${tool}`,material:material.has(tool)};
  }
  record(tool,args,outcome){ const trace={recorded:true,tool,args,outcome,material:material.has(tool)}; this.records.push(trace); return trace; }
  canFinalize(){ return true; }
  restore(){ return {restored:0}; }
}
class FakeFailureDoctrine { restore(){return {restored:0};} }
class FakeCapabilityBroker { coverage(){return {available:['evidence_verify']};} async invoke(tool){return {ok:true,verified:true,tool};} }

const originalLoad=Module._load;
Module._load=function(request,parent,isMain){
  if(request==='./tool-surface') return {RESTORED_MONOLITH_TOOLS:restored,MATERIAL_TOOLS:material,ToolExecutionGuard:FakeGuard};
  if(request==='./monolith-capability-broker') return {MonolithCapabilityBroker:FakeCapabilityBroker,CAPABILITY_TOOL_BINDINGS:{evidence_verify:['evidence','verify']}};
  if(request==='./failure-doctrine') return {FailureDoctrine:FakeFailureDoctrine};
  return originalLoad.apply(this,arguments);
};
const {GuardedMonolithToolBroker,SENSITIVE_ACTION_TOOLS}=require('../src/guarded-tool-broker');
Module._load=originalLoad;

(async()=>{
  assert(SENSITIVE_ACTION_TOOLS.has('delete_path'));
  assert(SENSITIVE_ACTION_TOOLS.has('process_stop'));
  assert(SENSITIVE_ACTION_TOOLS.has('browser_click'));
  assert(SENSITIVE_ACTION_TOOLS.has('snapshot_restore'));
  assert(!SENSITIVE_ACTION_TOOLS.has('read_file'));

  let executions=0;
  const execute=async(tool,args)=>{executions+=1;return {ok:true,tool,args};};

  const noAuthorizer=new GuardedMonolithToolBroker({historicalExecutor:execute,guard:new FakeGuard(),failureDoctrine:new FakeFailureDoctrine(),capabilityBroker:new FakeCapabilityBroker()});
  let result=await noAuthorizer.invoke('delete_path',{path:'x.txt'},{missionId:'m1'});
  assert.strictEqual(result.ok,false);
  assert.strictEqual(result.blocked,true);
  assert.strictEqual(result.reason,'action_authorization_required');
  assert.strictEqual(executions,0,'executor must not run without authorization');
  assert.strictEqual(noAuthorizer.guard.records.length,0,'authorization denial must not be recorded as tool execution');

  const deniedCalls=[];
  const denied=new GuardedMonolithToolBroker({
    historicalExecutor:execute,
    guard:new FakeGuard(),
    failureDoctrine:new FakeFailureDoctrine(),
    capabilityBroker:new FakeCapabilityBroker(),
    actionAuthorizer:async request=>{deniedCalls.push(request);return false;}
  });
  result=await denied.invoke('process_stop',{job_id:'j1'},{missionId:'m2',stepId:'s1'});
  assert.strictEqual(result.blocked,true);
  assert.strictEqual(result.reason,'action_authorization_denied');
  assert.strictEqual(executions,0);
  assert.strictEqual(deniedCalls.length,1);
  assert.strictEqual(deniedCalls[0].tool,'process_stop');
  assert.strictEqual(deniedCalls[0].category,'material-action');

  const throwing=new GuardedMonolithToolBroker({
    historicalExecutor:execute,
    guard:new FakeGuard(),
    failureDoctrine:new FakeFailureDoctrine(),
    capabilityBroker:new FakeCapabilityBroker(),
    actionAuthorizer:async()=>{throw new Error('auth backend down');}
  });
  result=await throwing.invoke('browser_click',{target:'submit'},{missionId:'m3'});
  assert.strictEqual(result.blocked,true);
  assert.strictEqual(result.reason,'action_authorization_error');
  assert.match(result.authorizationError,/auth backend down/);
  assert.strictEqual(executions,0);

  const approvedCalls=[];
  const approved=new GuardedMonolithToolBroker({
    historicalExecutor:execute,
    guard:new FakeGuard(),
    failureDoctrine:new FakeFailureDoctrine(),
    capabilityBroker:new FakeCapabilityBroker(),
    actionAuthorizer:async request=>{approvedCalls.push(request);return {allow:true};}
  });
  result=await approved.invoke('delete_path',{path:'x.txt'},{missionId:'m4',stepId:'s2'});
  assert.strictEqual(result.ok,true);
  assert.strictEqual(executions,1);
  assert.strictEqual(approvedCalls.length,1);
  assert.strictEqual(approved.guard.records.length,1);

  result=await approved.invoke('read_file',{path:'x.txt'},{missionId:'m4'});
  assert.strictEqual(result.ok,true);
  assert.strictEqual(executions,2);
  assert.strictEqual(approvedCalls.length,1,'observation tool must not request material-action authorization');

  const specializedCalls=[];
  const specializedBroker=new FakeCapabilityBroker();
  specializedBroker.invoke=async(tool,args,context)=>{specializedCalls.push({tool,args,context});return {ok:true,verified:true};};
  const specialized=new GuardedMonolithToolBroker({historicalExecutor:execute,guard:new FakeGuard(),failureDoctrine:new FakeFailureDoctrine(),capabilityBroker:specializedBroker});
  result=await specialized.invoke('evidence_verify',{id:'ev1'},{missionId:'m5'});
  assert.strictEqual(result.ok,true);
  assert.strictEqual(specializedCalls.length,1);
  assert.strictEqual(executions,2,'specialized observation must not fall through generic executor');

  const status=noAuthorizer.status();
  assert.strictEqual(status.sensitiveActionAuthorizationPresent,false);
  assert.strictEqual(status.sensitiveActionCount,SENSITIVE_ACTION_TOOLS.size);
  assert.strictEqual(status.materialActionAuthorizationCoverageComplete,true);

  console.log('guarded broker material-action authorization PASS',{
    missingAuthorizerFailsClosed:true,
    deniedActionNeverExecutes:true,
    authorizerFailureFailsClosed:true,
    approvedActionExecutesOnce:true,
    observationBypassesMaterialPrompt:true,
    specializedObservationRemainsSpecialized:true
  });
})().catch(error=>{console.error(error.stack||error);process.exit(1);});
