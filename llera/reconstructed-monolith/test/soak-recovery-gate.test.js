'use strict';

const assert = require('assert');
const { SoakRecoveryGate } = require('../src/soak-recovery-gate');

function fixtures({ evidenceFailsAt = null, markStableThrows = false } = {}) {
  let generation = 0;
  let stableCalls = 0;
  let runtimeState = { state: 'stopped', model: null, desiredModel: null, generation: 0, recoveryCount: 0 };
  const runtime = {
    async ensureRunning(model) { generation += 1; runtimeState = { ...runtimeState, state: 'ready', model, desiredModel: model, generation }; return this.snapshot(); },
    async recover() { generation += 1; runtimeState = { ...runtimeState, state: 'ready', model: runtimeState.desiredModel, generation, recoveryCount: runtimeState.recoveryCount + 1 }; return this.snapshot(); },
    async applyHostPressure(level) { return { level, aborted: ['low-priority-simulated'] }; },
    snapshot() { return { ...runtimeState }; },
  };
  const mission = { id: 'mission_soak', status: 'running', resumeCount: 0, checkpoints: [{ id: 'cp_1' }], toolTrace: [{ id: 'trace_1', tool: 'system_info' }] };
  const missionEngine = {
    getMission(id) { return id === mission.id ? JSON.parse(JSON.stringify(mission)) : null; },
    async startMission(id) { assert.strictEqual(id, mission.id); mission.status = 'running'; mission.resumeCount += 1; return this.getMission(id); },
  };
  const watchdog = {
    async launchProfile() { return { mode: 'normal' }; },
    async markStable() {
      stableCalls += 1;
      if (markStableThrows) throw new Error('state write failed');
      return { crashes: [], safeModeUntil: 0, lastStableAt: 9999 };
    }
  };
  const hostGuard = { async evaluate(sample) { return { level: sample.commitPercent >= 90 ? 'CRITICAL' : 'NORMAL', workers: sample.commitPercent >= 90 ? 1 : 8 }; } };
  const evidenceVerifier = async ({ cycle, runtime }) =>
    cycle !== evidenceFailsAt && runtime && runtime.state === 'ready' && runtime.desiredModel === 'qwen3-next-80b-q4km';

  return { runtime, missionEngine, watchdog, hostGuard, evidenceVerifier, mission, stableCalls: () => stableCalls };
}

(async () => {
  const ok = fixtures();
  const gate = new SoakRecoveryGate({ ...ok, now: (() => { let t = 1000; return () => ++t; })(), sleep: async () => {} });
  const report = await gate.run({ model: 'qwen3-next-80b-q4km', cycles: 35, recoveryEvery: 7, pressureEvery: 5, missionId: ok.mission.id, maxRecoveryCount: 5 });
  assert.strictEqual(report.pass, true);
  assert.strictEqual(report.schema, 2);
  assert.strictEqual(report.watchdogStabilityCommitted, true);
  assert.strictEqual(report.gates.watchdogStabilityCommitted, true);
  assert.strictEqual(ok.stableCalls(), 1);

  const failed = fixtures({ evidenceFailsAt: 3 });
  const failedGate = new SoakRecoveryGate({ ...failed, now: (() => { let t = 2000; return () => ++t; })(), sleep: async () => {} });
  const failedReport = await failedGate.run({ model: 'qwen3-next-80b-q4km', cycles: 10, missionId: failed.mission.id });
  assert.strictEqual(failedReport.pass, false);
  assert.strictEqual(failed.stableCalls(), 0, 'failed soak must never erase watchdog debt');

  const commitFailure = fixtures({ markStableThrows: true });
  const commitGate = new SoakRecoveryGate({ ...commitFailure, now: (() => { let t = 3000; return () => ++t; })(), sleep: async () => {} });
  const commitReport = await commitGate.run({ model: 'qwen3-next-80b-q4km', cycles: 10, missionId: commitFailure.mission.id });
  assert.strictEqual(commitReport.pass, false);
  assert.strictEqual(commitReport.gates.watchdogStabilityCommitted, false);
  assert(commitReport.failures.some(x => x.message.includes('stability commit failed')));

  console.log('MONOLITH soak/watchdog stability commit PASS', {
    verifiedSoakClearsDebt: true,
    failedSoakCannotClearDebt: true,
    stabilityWriteFailureBlocksPass: true
  });
})().catch(error => { console.error(error); process.exit(1); });
