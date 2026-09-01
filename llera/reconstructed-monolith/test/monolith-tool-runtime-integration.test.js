'use strict';

const assert = require('assert');
const Module = require('module');

const calls = [];

class FakeComputerExecutor {
  constructor(options = {}) { this.options = options; }
  coverage() { return {available:['read_file','write_file'], unavailable:['run_command','start_process','browser_open']}; }
  async invoke(tool,args,context) { calls.push(['computer',tool,args,context]); return {ok:true,tool,args}; }
}

class FakeCapabilityBroker {
  constructor(services = {}) { this.services = services; }
  coverage() { return {available:['evidence_verify'], unavailable:['vision_ocr_screen']}; }
  async invoke(tool,args,context) { calls.push(['specialized',tool,args,context]); return {ok:true,verified:true,tool}; }
}

class FakeRouter {
  constructor({capabilityBroker,computerExecutor}) { this.capabilityBroker=capabilityBroker; this.computerExecutor=computerExecutor; }
  coverage() {
    return {
      declaredCount:62,
      available:['read_file','write_file','evidence_verify'],
      unavailable:['run_command','start_process','browser_open','vision_ocr_screen'],
      routes:{read_file:'computer',write_file:'computer',evidence_verify:'specialized',browser_open:'unavailable-computer'},
      fullExecutionSurfaceAvailable:false
    };
  }
  async invoke(tool,args,context) {
    if (tool === 'evidence_verify') return this.capabilityBroker.invoke(tool,args,context);
    if (!this.computerExecutor.coverage().available.includes(tool)) throw new Error(`computer MONOLITH capability unavailable: ${tool}`);
    return this.computerExecutor.invoke(tool,args,context);
  }
}

class FakeGuardedBroker {
  constructor({historicalExecutor,capabilityBroker,actionAuthorizer}) { this.historicalExecutor=historicalExecutor; this.capabilityBroker=capabilityBroker; this.actionAuthorizer=actionAuthorizer; }
  restore(){ return {}; }
  async invoke(tool,args,context){
    if(tool === 'evidence_verify') return {ok:true,result:await this.capabilityBroker.invoke(tool,args,context),trace:{material:false,observation:true}};
    try { return {ok:true,result:await this.historicalExecutor(tool,args,context),trace:{material:tool==='write_file',observation:tool==='read_file'}}; }
    catch(error){ return {ok:false,error:String(error.message||error),trace:{material:false,observation:false}}; }
  }
  status(){ return {canFinalize:true,verificationDebt:null}; }
}

class FakeMissionToolCoordinator {
  constructor({missionEngine,broker,recoverySnapshots,autoCheckpoint}) {
    this.missionEngine=missionEngine; this.broker=broker; this.recoverySnapshots=recoverySnapshots; this.autoCheckpoint=autoCheckpoint;
  }
  async invoke({missionId,stepId,tool,args={},context={}}){
    const result=await this.broker.invoke(tool,args,{...context,missionId,stepId});
    if(result.ok){
      await this.missionEngine.appendToolTrace(missionId,{stepId,tool,outcome:result.trace.observation?'observed':'success',material:Boolean(result.trace.material),verification:Boolean(result.trace.observation)});
      if(this.autoCheckpoint && (result.trace.material || result.trace.observation)) await this.missionEngine.checkpoint(missionId,{type:result.trace.material?'material-action':'verification',stepId,tool});
    }
    return result;
  }
}

const stubs = {
  './monolith-computer-executor': {MonolithComputerExecutor:FakeComputerExecutor},
  './monolith-capability-broker': {MonolithCapabilityBroker:FakeCapabilityBroker},
  './agent-tool-router': {MonolithAgentToolRouter:FakeRouter},
  './guarded-tool-broker': {GuardedMonolithToolBroker:FakeGuardedBroker},
  './mission-tool-coordinator': {MissionToolCoordinator:FakeMissionToolCoordinator}
};
const originalLoad=Module._load;
Module._load=function(request,parent,isMain){ if(stubs[request]) return stubs[request]; return originalLoad.apply(this,arguments); };
const {createMonolithToolRuntime}=require('../src/monolith-tool-runtime');
Module._load=originalLoad;

(async()=>{
  const traces=[]; const checkpoints=[];
  const missionEngine={
    async appendToolTrace(missionId,entry){traces.push({missionId,...entry});return {id:`trace-${traces.length}`,...entry};},
    async checkpoint(missionId,payload){checkpoints.push({missionId,payload});return {id:`cp-${checkpoints.length}`,payload};},
    getMission(){return {toolTrace:[]};}
  };

  const runtime=createMonolithToolRuntime({missionEngine,workspaceRoot:'/workspace',allowOutsideWorkspace:false,capabilityServices:{evidence:{}}});
  assert.strictEqual(runtime.guardedBroker.historicalExecutor instanceof Function,true);
  assert.strictEqual(runtime.missionTools.broker,runtime.guardedBroker);

  const coverage=runtime.coverage();
  assert.strictEqual(coverage.declaredCount,62);
  assert.strictEqual(coverage.workspaceMode,'workspace-scoped');
  assert.strictEqual(coverage.physicalValidationClaimed,false);
  assert.strictEqual(coverage.shellAuthorizationPresent,false);
  assert.strictEqual(coverage.sensitiveActionAuthorizationPresent,false);
  assert.strictEqual(coverage.privateNetworkOptIn,false);
  assert.strictEqual(coverage.fullExecutionSurfaceAvailable,false);
  assert(coverage.unavailable.includes('run_command'));
  assert(coverage.unavailable.includes('browser_open'));
  assert(coverage.unavailable.includes('vision_ocr_screen'));

  let result=await runtime.missionTools.invoke({missionId:'m1',stepId:'s1',tool:'write_file',args:{path:'proof.txt',content:'ok'}});
  assert.strictEqual(result.ok,true);
  assert(calls.some(x=>x[0]==='computer'&&x[1]==='write_file'));
  assert(traces.some(x=>x.tool==='write_file'&&x.material===true));
  assert(checkpoints.some(x=>x.payload.type==='material-action'&&x.payload.tool==='write_file'));

  result=await runtime.missionTools.invoke({missionId:'m1',stepId:'s2',tool:'read_file',args:{path:'proof.txt'}});
  assert.strictEqual(result.ok,true);
  assert(calls.some(x=>x[0]==='computer'&&x[1]==='read_file'));
  assert(traces.some(x=>x.tool==='read_file'&&x.verification===true));
  assert(checkpoints.some(x=>x.payload.type==='verification'&&x.payload.tool==='read_file'));

  result=await runtime.missionTools.invoke({missionId:'m1',stepId:'s3',tool:'evidence_verify',args:{id:'ev1'}});
  assert.strictEqual(result.ok,true);
  assert(calls.some(x=>x[0]==='specialized'&&x[1]==='evidence_verify'));
  assert(!calls.some(x=>x[0]==='computer'&&x[1]==='evidence_verify'));

  result=await runtime.missionTools.invoke({missionId:'m1',stepId:'s4',tool:'browser_open',args:{url:'https://example.com'}});
  assert.strictEqual(result.ok,false);
  assert.match(result.error,/capability unavailable/);
  assert(!calls.some(x=>x[0]==='computer'&&x[1]==='browser_open'));

  const authorizer=async()=>true;
  const actionAuthorizer=async()=>true;
  const fullPc=createMonolithToolRuntime({missionEngine,allowOutsideWorkspace:true,commandAuthorizer:authorizer,actionAuthorizer,allowPrivateNetwork:true,capabilityBroker:new FakeCapabilityBroker()});
  assert.strictEqual(fullPc.coverage().workspaceMode,'full-pc-explicit');
  assert.strictEqual(fullPc.coverage().shellAuthorizationPresent,true);
  assert.strictEqual(fullPc.coverage().sensitiveActionAuthorizationPresent,true);
  assert.strictEqual(fullPc.coverage().privateNetworkOptIn,true);
  assert.strictEqual(fullPc.computerExecutor.options.allowOutsideWorkspace,true);
  assert.strictEqual(fullPc.computerExecutor.options.commandAuthorizer,authorizer);
  assert.strictEqual(fullPc.guardedBroker.actionAuthorizer,actionAuthorizer);
  assert.strictEqual(fullPc.computerExecutor.options.allowPrivateNetwork,true);

  console.log('MONOLITH canonical tool runtime integration PASS',{
    genericMissionPathToComputerExecutor:true,
    missionTraceAndCheckpointPersistence:true,
    specializedRouteCannotFallbackGeneric:true,
    unavailablePhysicalAdapterFailsClosed:true,
    workspaceScopedShellUnavailable:true,
    fullPcRequiresExplicitOptIn:true,
    shellAuthorizerForwarded:true,
    sensitiveActionAuthorizerForwarded:true,
    privateNetworkOptInForwarded:true,
    physicalValidationClaimed:false
  });
})().catch(error=>{console.error(error.stack||error);process.exit(1);});
