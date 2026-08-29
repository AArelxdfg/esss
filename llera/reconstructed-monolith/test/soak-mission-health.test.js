'use strict';

const assert = require('assert');
const { SoakRecoveryGate, isHealthyMissionStatus } = require('../src/soak-recovery-gate');

function makeFixture({ failAtCycle = null, failedStatus = 'failed', resumeStatus = 'running' } = {}) {
  let cycle = 0;
  let stableCalls = 0;
  const mission = { id: 'mission_soak', status: 'running' };
  const runtimeState = { state: 'ready', model: 'qwen3-next-80b-q4km', desiredModel: 'qwen3-next-80b-q4km', generation: 1 };
  const runtime = {
    async ensureRunning() { return { ...runtimeState }; },
    async recover() { runtimeState.generation += 1; return { ...runtimeState }; },
    async applyHostPressure() { return { aborted: [] }; },
    snapshot() { return { ...runtimeState }; }
  };
  const missionEngine = {
    getMission(id) {
      assert.strictEqual(id, mission.id);
      if (failAtCycle && cycle >= failAtCycle) mission.status = failedStatus;
      return { ...mission };
    },
    async startMission(id) {
      assert.strictEqual(id, mission.id);
      mission.status = resumeStatus;
      return { ...mission };
    }
  };
  const watchdog = {
    async launchProfile() { return { mode: 'normal' }; },
    async markStable() { stableCalls += 1; return { lastStableAt: 9999 }; }
  };
  const hostGuard = {
    async evaluate() { cycle += 1; return { level: 'NORMAL' }; }
  };
  const evidenceVerifier = async () => true;
  return { runtime, missionEngine, watchdog, hostGuard, evidenceVerifier, mission, stableCalls: () => stableCalls };
}

(async () => {
  assert.strictEqual(isHealthyMissionStatus('running'), true);
  assert.strictEqual(isHealthyMissionStatus('completed'), true);
  for (const bad of ['failed', 'blocked', 'cancelled', 'pending', 'interrupted', '', null]) {
    assert.strictEqual(isHealthyMissionStatus(bad), false);
  }

  const failed = makeFixture({ failAtCycle: 4, failedStatus: 'failed' });
  const gate = new SoakRecoveryGate({ ...failed, now: (() => { let t = 10; return () => ++t; })(), sleep: async () => {} });
  const report = await gate.run({ model: 'qwen3-next-80b-q4km', cycles: 10, missionId: failed.mission.id });
  assert.strictEqual(report.pass, false);
  assert.strictEqual(report.gates.missionHealthy, false);
  assert.strictEqual(failed.stableCalls(), 0, 'failed mission must never clear watchdog stability debt');
  assert(report.failures.some(x => x.message.includes('mission entered non-healthy status failed')));

  const blocked = makeFixture({ failAtCycle: 3, failedStatus: 'blocked' });
  const blockedGate = new SoakRecoveryGate({ ...blocked, now: (() => { let t = 20; return () => ++t; })(), sleep: async () => {} });
  const blockedReport = await blockedGate.run({ model: 'qwen3-next-80b-q4km', cycles: 8, missionId: blocked.mission.id });
  assert.strictEqual(blockedReport.pass, false);
  assert.strictEqual(blocked.stableCalls(), 0);

  const ok = makeFixture();
  const okGate = new SoakRecoveryGate({ ...ok, now: (() => { let t = 30; return () => ++t; })(), sleep: async () => {} });
  const okReport = await okGate.run({ model: 'qwen3-next-80b-q4km', cycles: 8, missionId: ok.mission.id });
  assert.strictEqual(okReport.pass, true);
  assert.strictEqual(okReport.gates.missionHealthy, true);
  assert.strictEqual(ok.stableCalls(), 1);

  console.log('MONOLITH soak mission-health gate PASS', {
    failedMissionBlocksPass: true,
    blockedMissionBlocksPass: true,
    watchdogDebtPreservedOnMissionFailure: true,
    healthyMissionStillCommitsStability: true
  });
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
