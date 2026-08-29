'use strict';
const assert = require('assert');
const { OutcomeMemory } = require('../src/outcome-memory');
const { VerifiedLearningCoordinator } = require('../src/verified-learning-coordinator');
const { receiptStateKey } = require('../src/verified-mission-finalizer');

function makeFinalization({missionId='m1',claim='verified claim',evidenceIds=['ev1']}={}) {
  const identity={
    missionId,
    claim,
    evidenceIds:[...evidenceIds],
    materialBindings:[],
    strictScore:.91,
    adversarialScore:.84,
    toolTraceDigest:'b'.repeat(64)
  };
  const stateKey=receiptStateKey(identity);
  const receipt={schema:2,...identity,stateKey,sha256:stateKey,issuedAt:1234};
  return {
    ok:true,
    publishable:true,
    receipt,
    verification:{strict:{score:.91},adversarial:{score:.84},evidenceIds:[...evidenceIds]}
  };
}

(async()=>{
  let memoryDurable=null;
  let learningDurable=null;
  const loadMemory=async()=>memoryDurable;
  const saveMemory=async state=>{memoryDurable=JSON.parse(JSON.stringify(state));};
  const memory=new OutcomeMemory({load:loadMemory,save:saveMemory,now:(()=>{let n=2000;return()=>++n;})()});
  await memory.init();

  const finalization=makeFinalization();
  const finalizer={finalize:async()=>JSON.parse(JSON.stringify(finalization))};
  const coordinator=new VerifiedLearningCoordinator({
    finalizer,
    outcomeMemory:memory,
    loadState:async()=>learningDurable,
    saveState:async state=>{learningDurable=JSON.parse(JSON.stringify(state));}
  });
  await coordinator.init();

  const first=await coordinator.finalizeAndLearn({
    missionId:'m1',goal:'restore safely',claim:'verified claim',
    skill:{name:'receipt-bound-skill',description:'derived only from verified finalization',procedure:['observe','act','verify']}
  });
  assert.strictEqual(first.ok,true);
  assert.strictEqual(first.learned,true);
  assert.strictEqual(first.outcome.verified,true);
  assert.strictEqual(first.outcome.verification.receiptSha256,finalization.receipt.sha256);
  assert.strictEqual(first.skillCandidate.sourceReceiptSha256,finalization.receipt.sha256);
  assert.strictEqual(first.skillCandidate.executable,false);

  const forged=makeFinalization({missionId:'m1',claim:'verified claim',evidenceIds:['ev1']});
  forged.receipt.toolTraceDigest='c'.repeat(64); // invalidate stateKey without changing claimed SHA
  const rejectedCoordinator=new VerifiedLearningCoordinator({
    finalizer:{finalize:async()=>forged},
    outcomeMemory:memory,
    loadState:async()=>null,
    saveState:async()=>{}
  });
  await rejectedCoordinator.init();
  await assert.rejects(
    () => rejectedCoordinator.finalizeAndLearn({missionId:'m1',goal:'forged',claim:'verified claim'}),
    error => error && error.code === 'OUTCOME_VERIFICATION_RECEIPT_INVALID'
  );
  assert.strictEqual(memory.snapshot().outcomes.length,1,'invalid receipt must not append learning outcome');

  const restoredMemory=new OutcomeMemory({load:loadMemory,save:saveMemory,now:()=>3000});
  await restoredMemory.init();
  const restarted=new VerifiedLearningCoordinator({
    finalizer,
    outcomeMemory:restoredMemory,
    loadState:async()=>learningDurable,
    saveState:async state=>{learningDurable=JSON.parse(JSON.stringify(state));}
  });
  await restarted.init();
  const second=await restarted.finalizeAndLearn({
    missionId:'m1',goal:'restore safely',claim:'verified claim',
    skill:{name:'receipt-bound-skill',description:'derived only from verified finalization',procedure:['observe','act','verify']}
  });
  assert.strictEqual(second.idempotent,true);
  assert.strictEqual(restoredMemory.snapshot().outcomes.length,1);
  assert.strictEqual(restoredMemory.snapshot().skillCandidates.length,1);

  console.log('MONOLITH verified learning receipt boundary PASS',{
    finalizerReceiptRequired:true,
    forgedReceiptRejected:true,
    skillBoundToVerifiedReceipt:true,
    restartIdempotent:true
  });
})().catch(error=>{console.error(error.stack||error);process.exit(1);});
