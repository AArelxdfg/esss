'use strict';

const assert = require('assert');
const { MATERIAL_TOOLS, ToolExecutionGuard } = require('../src/tool-surface');
const { GuardedMonolithToolBroker, SENSITIVE_ACTION_TOOLS } = require('../src/guarded-tool-broker');

function sorted(values){ return [...values].sort(); }

function makeCapabilityBroker(counter){
  return {
    coverage(){ return {supportedCount:14,availableCount:14,unavailableCount:0,available:[],unavailable:[]}; },
    async invoke(tool,args,context){ counter.count += 1; return {ok:true,tool,args,context}; }
  };
}

async function blockedCase(tool, mode){
  const generic={count:0};
  const specialized={count:0};
  const options={
    historicalExecutor:async()=>{generic.count += 1; return {ok:true};},
    capabilityBroker:makeCapabilityBroker(specialized),
    guard:new ToolExecutionGuard()
  };
  if(mode==='denied') options.actionAuthorizer=async()=>false;
  if(mode==='error') options.actionAuthorizer=async()=>{throw new Error('authorization backend unavailable');};
  const broker=new GuardedMonolithToolBroker(options);
  const result=await broker.invoke(tool,{audit_case:mode},{missionId:`m-${mode}-${tool}`,stepId:'s1'});
  assert.strictEqual(result.ok,false,`${tool}/${mode} must not succeed`);
  assert.strictEqual(result.blocked,true,`${tool}/${mode} must be blocked`);
  const expected=mode==='missing'?'action_authorization_required':mode==='denied'?'action_authorization_denied':'action_authorization_error';
  assert.strictEqual(result.reason,expected,`${tool}/${mode} wrong reason`);
  assert.strictEqual(generic.count,0,`${tool}/${mode} reached historical executor`);
  assert.strictEqual(specialized.count,0,`${tool}/${mode} reached capability executor`);
  assert.strictEqual(broker.guard.history.length,0,`${tool}/${mode} must not create execution trace`);
  return result;
}

(async()=>{
  const material=sorted(MATERIAL_TOOLS);
  const authorizedBoundary=sorted(SENSITIVE_ACTION_TOOLS);
  assert.strictEqual(material.length,21,'material tool count changed; audit scope must be reviewed explicitly');
  assert.deepStrictEqual(authorizedBoundary,material,'actionAuthorizer boundary must equal MATERIAL_TOOLS exactly');

  const cases=[];
  for(const tool of material){
    for(const mode of ['missing','denied','error']){
      const result=await blockedCase(tool,mode);
      cases.push({tool,mode,reason:result.reason});
    }
  }
  assert.strictEqual(cases.length,63);

  let observationExecutions=0;
  const observationBroker=new GuardedMonolithToolBroker({
    historicalExecutor:async(tool)=>{observationExecutions+=1;return {ok:true,tool};},
    capabilityBroker:makeCapabilityBroker({count:0}),
    guard:new ToolExecutionGuard()
  });
  const observed=await observationBroker.invoke('read_file',{path:'x.txt'},{missionId:'m-observe'});
  assert.strictEqual(observed.ok,true);
  assert.strictEqual(observationExecutions,1,'non-material observation must not require actionAuthorizer');

  let approvedGeneric=0;
  const approvalRequests=[];
  const approvedBroker=new GuardedMonolithToolBroker({
    historicalExecutor:async(tool)=>{approvedGeneric+=1;return {ok:true,tool};},
    capabilityBroker:makeCapabilityBroker({count:0}),
    guard:new ToolExecutionGuard(),
    actionAuthorizer:async request=>{approvalRequests.push(request);return {allow:true};}
  });
  const approved=await approvedBroker.invoke('write_file',{path:'approved.txt',content:'ok'},{missionId:'m-approved'});
  assert.strictEqual(approved.ok,true);
  assert.strictEqual(approvedGeneric,1);
  assert.strictEqual(approvalRequests.length,1);
  assert.strictEqual(approvalRequests[0].tool,'write_file');
  assert.strictEqual(approvalRequests[0].material,true);
  assert.strictEqual(approvalRequests[0].category,'material-action');

  const status=approvedBroker.status();
  assert.strictEqual(status.materialActionCount,21);
  assert.strictEqual(status.materialActionAuthorizationCoverageComplete,true);

  console.log('MONOLITH all-material action authorization PASS',{
    materialTools:material.length,
    failClosedCases:cases.length,
    missingAuthorizerNeverExecutes:true,
    deniedAuthorizerNeverExecutes:true,
    authorizerErrorNeverExecutes:true,
    genericAndSpecializedExecutorsProtected:true,
    observationBypassPreserved:true,
    approvedMaterialExecutesOnce:true
  });
})().catch(error=>{console.error(error.stack||error);process.exit(1);});
