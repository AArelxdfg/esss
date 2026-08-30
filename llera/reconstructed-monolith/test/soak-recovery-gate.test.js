'use strict';

const assert = require('assert');
const { SoakRecoveryGate, isDurableStabilityAcknowledgement } = require('../src/soak-recovery-gate');

function fixtures({ evidenceFailsAt = null, markStableThrows = false, markStableState = null, pressureResetThrows = false, startupThrows = false } = {}) {
  let generation = 0;
  let stableCalls = 0;
  const appliedPressures = [];
  let runtimeState = { state: 'stopped', model: null, desiredModel: null, generation: 0, recoveryCount: 0 };
  const runtime = {
    async ensureRunning(model) {
      if (startupThrows) throw new Error('synthetic runtime startup failure');
      generation += 1;
      runtimeState = { ...runtimeState, state: 'ready', model, desiredModel: model, generation };
      return this.snapshot();
    },
    async recover() { generation += 1; runtimeState = { ...runtimeState, state: 'ready', model: runtimeState.desiredModel, generation, recoveryCount: runtimeState.recoveryCount + 1 }; return this.snapshot(); },
    async applyHostPressure(level) {
      appliedPressures.push(level);
      if (pressureResetThrows && level === 'NORMAL' && appliedPressures.includes('CRITICAL')) throw new Error('pressure reset failed');
      return { level, aborted: level === 'CRITICAL' ? ['low-priority-simulated'] : [] };
    },
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
      return markStableState || { crashes: [], safeModeUntil: 0, lastStableAt: 9999 };
    }
  };
  const hostGuard = { async evaluate(sample) { return { level: sample.commitPercent >= 90 ? 'CRITICAL' : 'NORMAL', workers: sample.commitPercent >= 90 ? 1 : 8 }; } };
  const evidenceVerifier = async ({ cycle, runtime }) =>
    cycle !== evidenceFailsAt && runtime && runtime.state === 'ready' && runtime.desiredModel === 'qwen3-next-80b-q4km';

  return { runtime, missionEngine, watchdog, hostGuard, evidenceVerifier, mission, stableCalls: () => stableCalls, appliedPressures };
}

(async () => {
  assert.strictEqual(isDurableStabilityAcknowledgement({ crashes: [], safeModeUntil: 0, lastStableAt: 5000 }, 1000), true);
  assert.strictEqual(isDurableStabilityAcknowledgement(null, 1000), false);
  assert.strictEqual(isDurableStabilityAcknowledgement({ crashes: [], safeModeUntil: 0, lastStableAt: 999 }, 1000), false);
  assert.strictEqual(isDurableStabilityAcknowledgement({ crashes: ['recent-crash'], safeModeUntil: 0, lastStableAt: 5000 }, 1000), false);
  assert.strictEqual(isDurableStabilityAcknowledgement({ crashes: [], safeModeUntil: 6000, lastStableAt: 5000 }, 1000), false);
  assert.strictEqual(isDurableStabilityAcknowledgement({ crashes: [], safeModeUntil: 0, lastStableAt: 1000 }, Number.NaN), false);

  const ok = fixtures();
  const gate = new SoakRecoveryGate({ ...ok, now: (() => { let t = 1000; return () => ++t; })(), sleep: async () => {} });
  const report = await gate.run({ model: 'qwen3-next-80b-q4km', cycles: 35, recoveryEvery: 7, pressureEvery: 5, missionId: ok.mission.id, maxRecoveryCount: 5 });
  assert.strictEqual(report.pass, true);
  assert.strictEqual(report.schema, 6);
  assert.strictEqual(report.runtimeStartupSucceeded, true);
  assert.strictEqual(report.gates.runtimeStartupSucceeded, true);
  assert.strictEqual(report.watchdogStabilityCommitted, true);
  assert.strictEqual(report.gates.watchdogStabilityCommitted, true);
  assert.strictEqual(report.gates.pressureRestored, true);
  assert.strictEqual(report.finalRuntimePressure, 'NORMAL');
  assert.strictEqual(report.pressureResets, 1, 'a soak ending on CRITICAL must explicitly restore NORMAL');
  assert(ok.appliedPressures.includes('CRITICAL'), 'soak must exercise CRITICAL pressure');
  assert.strictEqual(ok.appliedPressures.at(-1), 'NORMAL', 'synthetic pressure must be cleared before stability commit');
  assert(Number.isFinite(report.watchdogStabilityCommitRequestedAt));
  assert(report.watchdogStableState.lastStableAt >= report.watchdogStabilityCommitRequestedAt);
  assert.strictEqual(ok.stableCalls(), 1);

  const startupFailure = fixtures({ startupThrows: true });
  const startupFailureGate = new SoakRecoveryGate({ ...startupFailure, now: (() => { let t = 1500; return () => ++t; })(), sleep: async () => {} });
  const startupFailureReport = await startupFailureGate.run({ model: 'qwen3-next-80b-q4km', cycles: 10, missionId: startupFailure.mission.id });
  assert.strictEqual(startupFailureReport.pass, false, 'runtime startup failure must return a blocked soak report');
  assert.strictEqual(startupFailureReport.runtimeStartupSucceeded, false);
  assert.strictEqual(startupFailureReport.gates.runtimeStartupSucceeded, false);
  assert.strictEqual(startupFailureReport.completedCycles, 0);
  assert.strictEqual(startupFailureReport.evidenceChecks, 0);
  assert.strictEqual(startupFailure.stableCalls(), 0, 'startup failure must never clear watchdog debt');
  assert.strictEqual(startupFailure.appliedPressures.at(-1), 'NORMAL', 'startup failure must still leave synthetic pressure in NORMAL');
  assert(startupFailureReport.failures.some(x => x.stage === 'runtime-startup' && x.message.includes('runtime startup failed')));

  const failed = fixtures({ evidenceFailsAt: 5 });
  const failedGate = new SoakRecoveryGate({ ...failed, now: (() => { let t = 2000; return () => ++t; })(), sleep: async () => {} });
  const failedReport = await failedGate.run({ model: 'qwen3-next-80b-q4km', cycles: 10, pressureEvery: 5, missionId: failed.mission.id });
  assert.strictEqual(failedReport.pass, false);
  assert.strictEqual(failed.stableCalls(), 0, 'failed soak must never erase watchdog debt');
  assert.strictEqual(failed.appliedPressures.at(-1), 'NORMAL', 'failed soak must also clear synthetic CRITICAL pressure');
  assert.strictEqual(failedReport.pressureResets, 1);

  const resetFailure = fixtures({ pressureResetThrows: true });
  const resetFailureGate = new SoakRecoveryGate({ ...resetFailure, now: (() => { let t = 2500; return () => ++t; })(), sleep: async () => {} });
  const resetFailureReport = await resetFailureGate.run({ model: 'qwen3-next-80b-q4km', cycles: 10, pressureEvery: 5, missionId: resetFailure.mission.id });
  assert.strictEqual(resetFailureReport.pass, false, 'failed pressure restoration must fail the final gate');
  assert.strictEqual(resetFailureReport.gates.pressureRestored, false);
  assert.strictEqual(resetFailure.stableCalls(), 0, 'pressure restoration failure must preserve watchdog debt');
  assert(resetFailureReport.failures.some(x => x.message.includes('host pressure reset failed')));

  const commitFailure = fixtures({ markStableThrows: true });
  const commitGate = new SoakRecoveryGate({ ...commitFailure, now: (() => { let t = 3000; return () => ++t; })(), sleep: async () => {} });
  const commitReport = await commitGate.run({ model: 'qwen3-next-80b-q4km', cycles: 10, missionId: commitFailure.mission.id });
  assert.strictEqual(commitReport.pass, false);
  assert.strictEqual(commitReport.gates.watchdogStabilityCommitted, false);
  assert(commitReport.failures.some(x => x.message.includes('stability commit failed')));

  const staleAck = fixtures({ markStableState: { crashes: [], safeModeUntil: 0, lastStableAt: 1 } });
  const staleAckGate = new SoakRecoveryGate({ ...staleAck, now: (() => { let t = 4000; return () => ++t; })(), sleep: async () => {} });
  const staleAckReport = await staleAckGate.run({ model: 'qwen3-next-80b-q4km', cycles: 10, missionId: staleAck.mission.id });
  assert.strictEqual(staleAckReport.pass, false);
  assert.strictEqual(staleAckReport.watchdogStabilityCommitted, false);
  assert.strictEqual(staleAckReport.gates.watchdogStabilityCommitted, false);
  assert.strictEqual(staleAck.stableCalls(), 1);
  assert(staleAckReport.failures.some(x => x.message.includes('invalid or stale stability acknowledgement')));

  let sameTick = 5000;
  const sameTickAck = fixtures({ markStableState: { crashes: [], safeModeUntil: 0, lastStableAt: sameTick } });
  const sameTickGate = new SoakRecoveryGate({ ...sameTickAck, now: () => sameTick++, sleep: async () => {} });
  const sameTickReport = await sameTickGate.run({ model: 'qwen3-next-80b-q4km', cycles: 10, missionId: sameTickAck.mission.id });
  assert.strictEqual(sameTickReport.pass, false, 'pre-existing stability timestamp must not satisfy a later commit request');
  assert.strictEqual(sameTickReport.gates.watchdogStabilityCommitted, false);
  assert(sameTickReport.watchdogStabilityCommitRequestedAt > 5000);
  assert(sameTickReport.failures.some(x => x.message.includes('invalid or stale stability acknowledgement')));

  assert.throws(() => gate.run({ model: 'qwen3-next-80b-q4km', cycles: 10, recoveryEvery: 0, missionId: ok.mission.id }), /recoveryEvery/);
  assert.throws(() => gate.run({ model: 'qwen3-next-80b-q4km', cycles: 10, pressureEvery: 0, missionId: ok.mission.id }), /pressureEvery/);

  console.log('MONOLITH soak/watchdog startup fail-closed durability PASS', {
    verifiedSoakClearsDebt: true,
    startupFailureReturnsBlockedReport: true,
    startupFailureCannotClearDebt: true,
    failedSoakCannotClearDebt: true,
    criticalPressureRestored: true,
    failedSoakPressureRestored: true,
    pressureResetFailureBlocksPass: true,
    stabilityWriteFailureBlocksPass: true,
    staleStabilityAckBlocksPass: true,
    sameTickPreexistingAckBlocksPass: true,
    invalidIntervalsRejected: true
  });
})().catch(error => { console.error(error); process.exit(1); });
