'use strict';

const assert = require('assert');
const { MissionToolCoordinator } = require('../src/mission-tool-coordinator');

function engineWith(checkpoints) {
  return {
    mission: { id:'m1', status:'running', currentStepId:'s1', toolTrace:[], checkpoints:JSON.parse(JSON.stringify(checkpoints)) },
    seq: 100,
    getMission(id) { return id === 'm1' ? JSON.parse(JSON.stringify(this.mission)) : null; },
    async appendToolTrace(id, entry) {
      const record = { id:`trace-${++this.seq}`, at:this.seq, ...entry };
      this.mission.toolTrace.push(record);
      return JSON.parse(JSON.stringify(record));
    },
    async checkpoint(id, payload) {
      const cp = { id:`checkpoint-${++this.seq}`, at:this.seq, payload:JSON.parse(JSON.stringify(payload)) };
      this.mission.checkpoints.push(cp);
      return JSON.parse(JSON.stringify(cp));
    }
  };
}

function broker() {
  return {
    guard: { classify: tool => ({ material:tool === 'write_file', observation:tool === 'read_file' }) },
    restore() { return this.status(); },
    status() { return { verificationDebt:null, canFinalize:true }; },
    async invoke(tool,args) {
      return {
        ok:true,
        blocked:false,
        trace:{ fingerprint:`${tool}:${JSON.stringify(args)}`, material:tool==='write_file', observation:tool==='read_file' },
        verificationDebt:null,
        canFinalize:true
      };
    }
  };
}

(async () => {
  const checkpoints = [
    { id:'debt-a', at:1, payload:{ type:'recovery-snapshot-debt', stepId:'s1', error:'A' } },
    { id:'debt-b', at:2, payload:{ type:'recovery-snapshot-debt', stepId:'s2', error:'B' } },
    { id:'repair-missing-id', at:3, payload:{ type:'recovery-snapshot-repaired', reason:'legacy-forged' } },
    { id:'repair-unknown', at:4, payload:{ type:'recovery-snapshot-repaired', debtCheckpointId:'does-not-exist' } },
    { id:'repair-a', at:5, payload:{ type:'recovery-snapshot-repaired', debtCheckpointId:'debt-a' } }
  ];
  const engine = engineWith(checkpoints);
  let snapshots = 0;
  const coordinator = new MissionToolCoordinator({
    missionEngine:engine,
    broker:broker(),
    recoverySnapshots:{ async create(){ snapshots += 1; return {id:`snap-${snapshots}`}; } }
  });

  let status = coordinator.status('m1');
  assert.strictEqual(status.recoverySnapshotDebtCount, 1);
  assert.deepStrictEqual(status.recoverySnapshotDebts.map(x=>x.id), ['debt-b']);
  assert.strictEqual(status.recoverySnapshotDebt.id, 'debt-b');
  assert.strictEqual(status.canFinalize, false);
  assert.strictEqual(coordinator.canFinalize('m1'), false);

  const blocked = await coordinator.invoke({ missionId:'m1', tool:'write_file', args:{path:'x'} });
  assert.strictEqual(blocked.blocked, true);
  assert.strictEqual(blocked.reason, 'recovery_snapshot_debt_open');
  assert.strictEqual(blocked.recoverySnapshotDebtCount, 1);

  const repair = await coordinator.repairRecoverySnapshot('m1');
  assert.strictEqual(repair.repaired, true);
  assert.strictEqual(repair.debtCheckpointId, 'debt-b');
  assert.strictEqual(repair.remainingDebtCount, 0);

  status = coordinator.status('m1');
  assert.strictEqual(status.recoverySnapshotDebtCount, 0);
  assert.strictEqual(status.recoverySnapshotDebt, null);
  assert.strictEqual(status.canFinalize, true);

  engine.mission.checkpoints.push({ id:'debt-c', at:200, payload:{ type:'recovery-snapshot-debt', error:'C' } });
  engine.mission.checkpoints.push({ id:'repair-empty', at:201, payload:{ type:'recovery-snapshot-repaired', debtCheckpointId:'' } });
  status = coordinator.status('m1');
  assert.deepStrictEqual(status.recoverySnapshotDebts.map(x=>x.id), ['debt-c']);
  assert.strictEqual(status.canFinalize, false);

  console.log('MONOLITH multi recovery-snapshot debt PASS', {
    multipleDebtsTracked:true,
    missingRepairBindingFailsClosed:true,
    unknownRepairBindingFailsClosed:true,
    explicitRepairClearsOnlyBoundDebt:true,
    compatibilitySingleDebtFieldPreserved:true
  });
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
