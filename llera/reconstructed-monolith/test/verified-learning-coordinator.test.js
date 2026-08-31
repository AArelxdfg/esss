'use strict';
const assert = require('assert');
const crypto = require('crypto');
const { VerifiedLearningCoordinator } = require('../src/verified-learning-coordinator');
const { receiptStateKey } = require('../src/verified-mission-finalizer');

(async()=>{
  let durable = null;
  const memoryState = { outcomes: [], skillCandidates: [] };
  const toolTraceDigest = crypto.createHash('sha256').update('verified-final').digest('hex');
  const receipt = receiptStateKey({missionId:'m1',claim:'verified',evidenceIds:['ev1'],materialBindings:[],strictScore:.9,adversarialScore:.8,toolTraceDigest});
  const memory = {
    snapshot:()=>JSON.parse(JSON.stringify(memoryState)),
    async recordOutcome(x){ const o={id:'out-1',...x,verified:true}; memoryState.outcomes.push(o); return JSON.parse(JSON.stringify(o)); },
    async proposeSkill(x){ const c={id:'skill-1',sourceOutcomeId:'out-1',trust:'candidate-only',executable:false,...x}; memoryState.skillCandidates.push(c); return JSON.parse(JSON.stringify(c)); }
  };
  const finalizer={ async finalize(){ return {ok:true,publishable:true,receipt:{schema:2,missionId:'m1',claim:'verified',sha256:receipt,stateKey:receipt,evidenceIds:['ev1'],materialBindings:[],toolTraceDigest,strictScore:.9,adversarialScore:.8},verification:{strict:{score:.9},adversarial:{score:.8},evidenceIds:['ev1']}}; } };
  const c=new VerifiedLearningCoordinator({finalizer,outcomeMemory:memory,loadState:async()=>durable,saveState:async s=>{durable=JSON.parse(JSON.stringify(s));}});
  await c.init();
  const first=await c.finalizeAndLearn({missionId:'m1',goal:'restore',claim:'verified',skill:{name:'repeat-restore',description:'repeat',procedure:['observe','act','verify']}});
  assert.strictEqual(first.learned,true); assert.strictEqual(memoryState.outcomes.length,1); assert.strictEqual(memoryState.skillCandidates.length,1);
  const c2=new VerifiedLearningCoordinator({finalizer,outcomeMemory:memory,loadState:async()=>durable,saveState:async s=>{durable=JSON.parse(JSON.stringify(s));}});
  await c2.init();
  const second=await c2.finalizeAndLearn({missionId:'m1',goal:'restore',claim:'verified',skill:{name:'repeat-restore',description:'repeat',procedure:['observe','act','verify']}});
  assert.strictEqual(second.idempotent,true); assert.strictEqual(memoryState.outcomes.length,1); assert.strictEqual(memoryState.skillCandidates.length,1);
  const rejected=new VerifiedLearningCoordinator({finalizer:{finalize:async()=>({ok:false,publishable:false,reason:'verification_debt_open'})},outcomeMemory:memory,loadState:async()=>null,saveState:async()=>{}}); await rejected.init();
  const r=await rejected.finalizeAndLearn({missionId:'m2',goal:'unsafe'}); assert.strictEqual(r.learned,false); assert.strictEqual(memoryState.outcomes.length,1);
  console.log('verified learning coordinator PASS',{verifiedOnly:true,restartIdempotent:true,skillCandidateOnly:true,outcomes:1,skills:1});
})().catch(e=>{console.error(e);process.exit(1)});
