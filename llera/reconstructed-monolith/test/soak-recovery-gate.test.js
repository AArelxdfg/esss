'use strict';

const assert = require('assert');
const { SoakRecoveryGate } = require('../src/soak-recovery-gate');

(async () => {
  let generation = 0;
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
  const watchdog = { async launchProfile() { return { mode: 'normal' }; } };
  const hostGuard = { async evaluate(sample) { return { level: sample.commitPercent >= 90 ? 'CRITICAL' : 'NORMAL', workers: sample.commitPercent >= 90 ? 1 : 8 }; } };
  const evidenceVerifier = async ({ runtime }) => runtime && runtime.state === 'ready' && runtime.desiredModel === 'qwen3-next-80b-q4km';
  const gate = new SoakRecoveryGate({ runtime, missionEngine, watchdog, hostGuard, evidenceVerifier, now: (() => { let t = 1000; return () => ++t; })(), sleep: async () => {} });
  const report = await gate.run({ model: 'qwen3-next-80b-q4km', cycles: 35, recoveryEvery: 7, pressureEvery: 5, missionId: mission.id, maxRecoveryCount: 5 });
  assert.strictEqual(report.pass, true);
  assert.strictEqual(report.completedCycles, 35);
  assert.strictEqual(report.runtimeRecoveries, 5);
  assert.strictEqual(report.pressureEvents, 7);
  assert.strictEqual(report.evidenceChecks, 35);
  assert.strictEqual(report.failures.length, 0);
  console.log('MONOLITH soak/recovery gate PASS', { cycles: report.completedCycles, recoveries: report.runtimeRecoveries, pressureEvents: report.pressureEvents, evidenceChecks: report.evidenceChecks });
})().catch(error => { console.error(error); process.exit(1); });
