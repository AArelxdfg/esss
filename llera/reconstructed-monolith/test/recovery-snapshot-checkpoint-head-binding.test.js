'use strict';
const assert = require('assert');
const { RecoverySnapshotCoordinator } = require('../src/recovery-snapshot-coordinator');

(async () => {
  let durableMission = {
    id:'m1', status:'interrupted', checkpoints:[{id:'cp1',at:1}], toolTrace:[{tool:'write_file',material:true,outcome:'success'}]
  };
  const missionEngine = { snapshot: () => ({schema:1,missions:{m1:JSON.parse(JSON.stringify(durableMission))},order:['m1']}) };
  const ledgerState = { value:[{id:'current'}] };
  const evidenceLedger = {
    export: () => JSON.parse(JSON.stringify(ledgerState.value)),
    import: value => { ledgerState.value = JSON.parse(JSON.stringify(value)); }
  };
  const toolGuard = { verificationDebt:null, restore(trace){ this.verificationDebt = trace.length ? {tool:trace.at(-1).tool} : null; return {restored:trace.length}; } };
  let saved = null;
  const coordinator = new RecoverySnapshotCoordinator({ missionEngine, toolGuard, evidenceLedger, saveSnapshot: async s => { saved = JSON.parse(JSON.stringify(s)); }, loadSnapshot: async () => JSON.parse(JSON.stringify(saved)), now: () => 10 });

  await coordinator.create({missionId:'m1'});
  durableMission.checkpoints.push({id:'cp2',at:2});
  durableMission.toolTrace.push({tool:'hash_file',verification:true,outcome:'verified'});

  const beforeEvidence = JSON.stringify(ledgerState.value);
  await assert.rejects(() => coordinator.restore({missionId:'m1'}), /checkpoint head mismatch/);
  assert.strictEqual(JSON.stringify(ledgerState.value), beforeEvidence, 'stale snapshot must not mutate evidence ledger');
  assert.strictEqual(toolGuard.verificationDebt, null, 'stale snapshot must not mutate tool guard');

  durableMission.checkpoints.pop();
  durableMission.toolTrace.pop();
  const restored = await coordinator.restore({missionId:'m1'});
  assert.strictEqual(restored.restored, true);
  assert.strictEqual(restored.checkpointHeadId, 'cp1');
  assert.strictEqual(restored.evidenceCount, 1);
  console.log('RECOVERY_SNAPSHOT_CHECKPOINT_HEAD_BINDING_PASS');
})().catch(error => { console.error(error); process.exit(1); });
