'use strict';

const assert = require('assert');
const { SoakRecoveryGate } = require('../src/soak-recovery-gate');

(async () => {
  const targetModel = 'qwen3-next-80b-q4km';
  let stableCalls = 0;
  let cycleSnapshots = 0;
  const runtime = {
    async ensureRunning() { return this.snapshot(); },
    async recover() { return this.snapshot(); },
    async applyHostPressure() { return { level: 'NORMAL' }; },
    snapshot() {
      cycleSnapshots += 1;
      return {
        state: 'ready',
        desiredModel: targetModel,
        // Simulate a lifecycle drift/rollback where intent still points at the
        // requested model but a different model is actually serving.
        model: cycleSnapshots > 20 ? 'qwen3-4b-q4km' : targetModel,
        generation: 3,
        recoveryCount: 0
      };
    }
  };
  const mission = { id: 'mission_identity', status: 'running' };
  const missionEngine = { getMission: id => id === mission.id ? { ...mission } : null, startMission: async () => ({ ...mission }) };
  const watchdog = {
    async launchProfile() { return { mode: 'normal' }; },
    async markStable() { stableCalls += 1; return { crashes: [], safeModeUntil: 0, lastStableAt: 999999 }; }
  };
  const hostGuard = { async evaluate() { return { level: 'NORMAL' }; } };
  const evidenceVerifier = async ({ runtime: state }) => Boolean(state && state.state === 'ready' && state.desiredModel === targetModel);
  let t = 1000;
  const gate = new SoakRecoveryGate({ runtime, missionEngine, watchdog, hostGuard, evidenceVerifier, now: () => ++t, sleep: async () => {} });

  const report = await gate.run({ model: targetModel, cycles: 10, recoveryEvery: 7, pressureEvery: 5, missionId: mission.id });

  assert.strictEqual(report.schema, 7);
  assert.strictEqual(report.gates.desiredModelPreserved, true, 'intent must still point at the requested model in this regression');
  assert.strictEqual(report.gates.activeModelPreserved, false, 'actual serving model drift must block the gate');
  assert.strictEqual(report.pass, false, 'soak must fail closed when actual and desired model identities diverge');
  assert.strictEqual(stableCalls, 0, 'model identity drift must preserve watchdog stability debt');

  console.log('SOAK_ACTIVE_MODEL_IDENTITY_FAIL_CLOSED_PASS');
})().catch(error => { console.error(error); process.exit(1); });
