'use strict';

const assert = require('assert');
const { MissionToolCoordinator } = require('../src/mission-tool-coordinator');

class FakeMissionEngine {
  constructor() {
    this.mission = { id:'m1', status:'running', currentStepId:'s1', toolTrace:[], checkpoints:[] };
    this.seq = 0;
  }
  getMission(id) { return id === this.mission.id ? JSON.parse(JSON.stringify(this.mission)) : null; }
  async appendToolTrace(id, entry) {
    assert.strictEqual(id, this.mission.id);
    const record = { id:`trace-${++this.seq}`, at:this.seq, ...entry };
    this.mission.toolTrace.push(record);
    return JSON.parse(JSON.stringify(record));
  }
  async checkpoint(id, payload) {
    assert.strictEqual(id, this.mission.id);
    const checkpoint = { id:`checkpoint-${++this.seq}`, at:this.seq, payload:JSON.parse(JSON.stringify(payload)) };
    this.mission.checkpoints.push(checkpoint);
    return JSON.parse(JSON.stringify(checkpoint));
  }
}

class FakeBroker {
  constructor() {
    this.debt = null;
    this.guard = { classify: tool => ({ material:tool === 'write_file', observation:tool === 'read_file' }) };
  }
  restore(trace = []) {
    this.debt = null;
    for (const entry of trace) {
      if (entry.material && entry.outcome !== 'failed') this.debt = { fingerprint:entry.argumentsHash };
      if (entry.verification && entry.outcome !== 'failed') this.debt = null;
    }
    return this.status();
  }
  status() { return { verificationDebt:this.debt, canFinalize:!this.debt }; }
  async invoke(tool, args) {
    if (this.debt && tool === 'write_file') {
      return { ok:false, blocked:true, reason:'verification_debt_open', verificationDebt:this.debt };
    }
    const material = tool === 'write_file';
    const observation = tool === 'read_file';
    const fingerprint = `${tool}:${JSON.stringify(args)}`;
    if (material) this.debt = { fingerprint };
    if (observation) this.debt = null;
    return {
      ok:true,
      blocked:false,
      result:{ tool,args },
      trace:{ fingerprint,material,observation },
      verificationDebt:this.debt,
      canFinalize:!this.debt
    };
  }
}

(async () => {
  const missionEngine = new FakeMissionEngine();
  const broker = new FakeBroker();
  let snapshotAttempts = 0;
  let snapshotFailure = true;
  const recoverySnapshots = {
    async create(input) {
      snapshotAttempts += 1;
      if (snapshotFailure) throw new Error('snapshot backend unavailable');
      return { id:`snapshot-${snapshotAttempts}`, ...input };
    }
  };
  const coordinator = new MissionToolCoordinator({ missionEngine, broker, recoverySnapshots });

  const write = await coordinator.invoke({ missionId:'m1', tool:'write_file', args:{path:'x.txt',text:'hello'} });
  assert.strictEqual(write.ok, true);
  assert.strictEqual(write.persisted, true);
  assert.strictEqual(write.degraded, true);
  assert.strictEqual(write.recoverySnapshot.debt, true);
  assert.strictEqual(missionEngine.mission.toolTrace.length, 1);
  assert(missionEngine.mission.checkpoints.some(c => c.payload.type === 'material-action'));
  assert(missionEngine.mission.checkpoints.some(c => c.payload.type === 'recovery-snapshot-debt'));
  assert.strictEqual(coordinator.canFinalize('m1'), false);

  const verify = await coordinator.invoke({ missionId:'m1', tool:'read_file', args:{path:'x.txt'} });
  assert.strictEqual(verify.ok, true);
  assert.strictEqual(verify.persisted, true);

  const blocked = await coordinator.invoke({ missionId:'m1', tool:'write_file', args:{path:'y.txt',text:'must-not-run'} });
  assert.strictEqual(blocked.blocked, true);
  assert.strictEqual(blocked.reason, 'recovery_snapshot_debt_open');
  assert.strictEqual(missionEngine.mission.toolTrace.length, 2);

  snapshotFailure = false;
  const repair = await coordinator.repairRecoverySnapshot('m1');
  assert.strictEqual(repair.repaired, true);
  assert.strictEqual(coordinator.status('m1').recoverySnapshotDebt, null);
  assert.strictEqual(coordinator.canFinalize('m1'), true);

  const next = await coordinator.invoke({ missionId:'m1', tool:'write_file', args:{path:'y.txt',text:'safe-after-repair'} });
  assert.strictEqual(next.ok, true);
  assert.strictEqual(next.blocked, false);

  console.log('MONOLITH mission recovery-snapshot debt PASS', {
    materialActionNotRetriedOnSnapshotFailure:true,
    durableSnapshotDebt:true,
    futureMaterialActionsFailClosed:true,
    observationsRemainAvailableForVerification:true,
    explicitRepairClearsDebt:true
  });
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
