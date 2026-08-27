'use strict';
const assert = require('assert');
const { RuntimeInferenceCoordinator } = require('../src/runtime-inference-coordinator');
const { HostguardRuntimeCoordinator } = require('../src/hostguard-runtime-coordinator');

(async()=>{
  const runtimeTasks=new Map();
  const governorActive=new Set();
  const runtime={
    registerInference(id,{priority,abort}){ runtimeTasks.set(id,{priority,abort}); return {generation:1}; },
    completeInference(id){ return runtimeTasks.delete(id); },
    async applyHostPressure(level){
      const aborted=[];
      if(level==='critical'){
        for(const [id,task] of [...runtimeTasks]){
          if(task.priority==='low'){ task.abort(); runtimeTasks.delete(id); aborted.push(id); }
        }
      }
      return {aborted};
    },
    snapshot(){ return {active:[...runtimeTasks.keys()]}; }
  };
  const inferenceGovernor={
    admit({id,className}){ governorActive.add(id); return {allow:true,id,className,maxTokens:1024,reasoning:'normal',pressure:'normal',startedAt:1}; },
    complete(id){ return governorActive.delete(id); },
    snapshot(){ return {active:[...governorActive]}; }
  };
  const coordinator=new RuntimeInferenceCoordinator({runtime,governor:inferenceGovernor});
  let aborts=0;
  assert.strictEqual(coordinator.begin({id:'interactive-1',className:'interactive',abort:()=>aborts++}).allow,true);
  assert.strictEqual(coordinator.begin({id:'council-1',className:'council',abort:()=>aborts++}).allow,true);
  assert.strictEqual(coordinator.begin({id:'adversarial-1',className:'adversarial',abort:()=>aborts++}).allow,true);
  assert.strictEqual(governorActive.size,3);

  const hostGovernor={
    state:'normal',
    update(metrics){ this.state=metrics.state; return {state:this.state,score:metrics.score||0,policy:this.policy()}; },
    policy(){ return this.state==='critical'
      ? {pressure:'critical',downloadWorkers:1,allowVisionLoad:false,unloadVision:true,runtimePriority:'BelowNormal'}
      : {pressure:'normal',downloadWorkers:8,allowVisionLoad:true,unloadVision:false,runtimePriority:'BelowNormal'}; }
  };
  const host=new HostguardRuntimeCoordinator({governor:hostGovernor,runtime,inferenceCoordinator:coordinator});
  const critical=await host.sample({state:'critical',score:.95});
  const reconcile=critical.actions.find(x=>x.type==='inference-reconcile');
  assert.deepStrictEqual(reconcile.reconciled.sort(),['adversarial-1','council-1']);
  assert.strictEqual(aborts,2);
  assert.deepStrictEqual(coordinator.snapshot().active.map(x=>x.id),['interactive-1']);
  assert.deepStrictEqual([...governorActive],['interactive-1']);
  assert.deepStrictEqual(runtime.snapshot().active,['interactive-1']);

  const repeated=await host.sample({state:'critical',score:.94});
  assert.strictEqual(repeated.actions.some(x=>x.type==='inference-reconcile'),false);
  assert.deepStrictEqual([...governorActive],['interactive-1']);

  coordinator.complete('interactive-1');
  assert.strictEqual(governorActive.size,0);
  assert.strictEqual(runtimeTasks.size,0);

  console.log('HOSTGUARD preemption reconciliation PASS',{abortedLowPriority:2,governorSlotsReleased:true,interactivePreserved:true,repeatedCriticalIdempotent:true});
})().catch(e=>{console.error(e);process.exit(1);});
