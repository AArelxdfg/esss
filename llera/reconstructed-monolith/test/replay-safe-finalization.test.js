'use strict';

const assert = require('assert');
const Module = require('module');
const path = require('path');
const finalizerPath = path.resolve(__dirname, '../src/verified-mission-finalizer.js');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (parent && parent.filename === finalizerPath && request === './dual-verifier') {
    return { DualVerifier: class { verify({evidence}) { return {ok:true,evidenceIds:evidence.map(e => e.id).reverse(),strict:{score:0.91},adversarial:{score:0.83}}; } } };
  }
  return originalLoad.apply(this, arguments);
};
const { VerifiedMissionFinalizer } = require('../src/verified-mission-finalizer');
Module._load = originalLoad;

(async () => {
  let clock = 100;
  const mission = {id:'m1',status:'completed',checkpoints:[],toolTrace:[
    {id:'t1',stepId:'s1',tool:'write_file',outcome:'success',material:true,verification:false,scope:'artifact.bin',evidenceIds:[]},
    {id:'t2',stepId:'s1',tool:'read_file',outcome:'observed',material:false,verification:true,scope:'artifact.bin',evidenceIds:['ev-b','ev-a']}
  ]};
  let checkpointWrites = 0;
  const missionEngine = {
    getMission: id => id === 'm1' ? JSON.parse(JSON.stringify(mission)) : null,
    checkpoint: async (id, payload) => {
      checkpointWrites += 1;
      const checkpoint = {id:`cp-${checkpointWrites}`,at:++clock,status:'completed',currentStepId:null,completedStepIds:['s1'],payload:JSON.parse(JSON.stringify(payload))};
      mission.checkpoints.push(checkpoint);
      return JSON.parse(JSON.stringify(checkpoint));
    }
  };
  const evidence = [{id:'ev-a',missionId:'m1',target:'x.txt',sha256:'a'.repeat(64)},{id:'ev-b',missionId:'m1',target:'x.txt',sha256:'b'.repeat(64)}];
  const finalizer = new VerifiedMissionFinalizer({missionEngine,missionToolCoordinator:{canFinalize:()=>true},evidenceLedger:{snapshot:()=>evidence},now:()=>++clock});
  const first = await finalizer.finalize({missionId:'m1',claim:'verified restore'});
  assert.strictEqual(first.replayed,false);
  assert.strictEqual(checkpointWrites,1);
  clock += 10000;
  const second = await finalizer.finalize({missionId:'m1',claim:'verified restore'});
  assert.strictEqual(second.replayed,true);
  assert.strictEqual(second.receipt.sha256,first.receipt.sha256);
  assert.strictEqual(second.receipt.issuedAt,first.receipt.issuedAt);
  assert.strictEqual(second.checkpoint.id,first.checkpoint.id);
  assert.strictEqual(checkpointWrites,1);
  const orderingFinalizer = new VerifiedMissionFinalizer({missionEngine,missionToolCoordinator:{canFinalize:()=>true},evidenceLedger:{snapshot:()=>[...evidence].reverse()},dualVerifier:{verify:()=>({ok:true,evidenceIds:['ev-a','ev-b'],strict:{score:0.91},adversarial:{score:0.83}})},now:()=>++clock});
  const reordered = orderingFinalizer.evaluate({missionId:'m1',claim:'verified restore'});
  assert.strictEqual(reordered.receipt.sha256,first.receipt.sha256);
  mission.toolTrace.push({id:'t3',stepId:'s1',tool:'system_info',outcome:'observed',material:false,verification:true,evidenceIds:['ev-a']});
  const changed = finalizer.evaluate({missionId:'m1',claim:'verified restore'});
  assert.notStrictEqual(changed.receipt.sha256,first.receipt.sha256);
  console.log('replay-safe finalization receipt PASS',{stableAcrossTime:true,noDuplicateCheckpoint:true,evidenceOrderCanonical:true,traceMutationInvalidates:true});
})().catch(error => { console.error(error); process.exit(1); });
