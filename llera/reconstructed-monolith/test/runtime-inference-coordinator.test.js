'use strict';
const assert = require('assert');
const { RuntimeInferenceCoordinator } = require('../src/runtime-inference-coordinator');

class Governor {
  constructor() { this.pressure='normal'; this.active=new Map(); this.total=4; }
  admit({ id, className, requestedTokens }) {
    if (this.active.has(id)) return {allow:false,reason:'unique_inference_id_required'};
    if (this.pressure==='critical' && ['council','adversarial'].includes(className)) return {allow:false,reason:'class_blocked_by_host_pressure',className,pressure:this.pressure};
    if (this.active.size>=this.total) return {allow:false,reason:'host_concurrency_limit'};
    const maxTokens=Math.min(Number(requestedTokens||4096), this.pressure==='critical'?4096:8192);
    const admission={allow:true,id,className,pressure:this.pressure,maxTokens,reasoning:this.pressure==='critical'?'minimal':'normal',startedAt:100+this.active.size};
    this.active.set(id,admission); return admission;
  }
  complete(id){ return this.active.delete(id); }
  snapshot(){ return {pressure:this.pressure,active:[...this.active.keys()]}; }
}
class Runtime {
  constructor(){ this.state='ready'; this.generation=7; this.active=new Map(); }
  registerInference(id,{priority,abort}){ if(this.state!=='ready') throw new Error('runtime is not ready'); if(this.active.has(id)) throw new Error('unique inference id required'); const task={id,priority,abort,generation:this.generation}; this.active.set(id,task); return task; }
  completeInference(id, expectedGeneration){ const task=this.active.get(id); if(!task || expectedGeneration===null || expectedGeneration===undefined || task.generation!==expectedGeneration) return false; return this.active.delete(id); }
  snapshot(){ return {state:this.state,generation:this.generation,activeInference:[...this.active.values()].map(x=>({id:x.id,generation:x.generation}))}; }
}
(() => {
  const runtime=new Runtime(); const governor=new Governor(); const c=new RuntimeInferenceCoordinator({runtime,governor});
  const interactive=c.begin({id:'i1',className:'interactive',requestedTokens:12000,abort:()=>{}});
  assert.strictEqual(interactive.allow,true); assert.strictEqual(interactive.priority,'high'); assert.strictEqual(interactive.maxTokens,8192);
  const council=c.begin({id:'c1',className:'council',requestedTokens:6000,abort:()=>{}});
  assert.strictEqual(council.allow,true); assert.strictEqual(council.priority,'low');
  assert.strictEqual(c.complete('c1', council.generation),true); assert.strictEqual(governor.active.has('c1'),false); assert.strictEqual(runtime.active.has('c1'),false);
  governor.pressure='critical';
  const blocked=c.begin({id:'c2',className:'council',abort:()=>{}});
  assert.strictEqual(blocked.allow,false); assert.strictEqual(blocked.reason,'class_blocked_by_host_pressure'); assert.strictEqual(runtime.active.has('c2'),false);
  const mission=c.begin({id:'m1',className:'mission',requestedTokens:9000,abort:()=>{}});
  assert.strictEqual(mission.allow,true); assert.strictEqual(mission.priority,'normal'); assert.strictEqual(mission.maxTokens,4096); assert.strictEqual(mission.reasoning,'minimal');
  runtime.state='failed'; let rollback=true;
  try { c.begin({id:'i2',className:'interactive',abort:()=>{}}); rollback=false; } catch(e){ assert.match(e.message,/runtime is not ready/); }
  assert.strictEqual(rollback,true); assert.strictEqual(governor.active.has('i2'),false);
  console.log('runtime inference admission bridge PASS', {governorEnforced:true,lowPriorityMapping:true,criticalAdmissionBlock:true,tokenReasoningProfile:true,admissionRollbackOnRuntimeFailure:true,generationBoundCompletion:true});
})();
