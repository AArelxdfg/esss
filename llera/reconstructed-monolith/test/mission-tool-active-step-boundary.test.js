'use strict';

const assert = require('node:assert');
const { MissionToolCoordinator } = require('../src/mission-tool-coordinator');

function makeCoordinator(mission) {
  let invoked = 0;
  let appended = 0;
  const missionEngine = {
    getMission: () => JSON.parse(JSON.stringify(mission)),
    appendToolTrace: async () => { appended += 1; return { id: 'trace-test' }; },
    checkpoint: async () => ({ id: 'checkpoint-test' })
  };
  const broker = {
    restore: () => ({}),
    status: () => ({ canFinalize: true, verificationDebt: null }),
    invoke: async () => {
      invoked += 1;
      return { ok: true, blocked: false, trace: { material: false, observation: true } };
    }
  };
  return {
    coordinator: new MissionToolCoordinator({ missionEngine, broker }),
    counters: () => ({ invoked, appended })
  };
}

(async () => {
  const paused = makeCoordinator({
    id: 'mission-paused',
    status: 'paused',
    currentStepId: null,
    toolTrace: [],
    checkpoints: [],
    steps: [{ id: 'step-1', status: 'pending' }]
  });

  await assert.rejects(
    () => paused.coordinator.invoke({ missionId: 'mission-paused', stepId: 'step-1', tool: 'path_exists', args: { path: 'x' } }),
    error => error && error.code === 'MISSION_TOOL_MISSION_NOT_RUNNING'
  );
  assert.deepStrictEqual(paused.counters(), { invoked: 0, appended: 0 });

  const runningWithoutActiveStep = makeCoordinator({
    id: 'mission-running',
    status: 'running',
    currentStepId: null,
    toolTrace: [],
    checkpoints: [],
    steps: [{ id: 'step-1', status: 'pending' }]
  });

  await assert.rejects(
    () => runningWithoutActiveStep.coordinator.invoke({ missionId: 'mission-running', stepId: 'step-1', tool: 'path_exists', args: { path: 'x' } }),
    error => error && error.code === 'MISSION_TOOL_NO_ACTIVE_STEP'
  );
  assert.deepStrictEqual(runningWithoutActiveStep.counters(), { invoked: 0, appended: 0 });

  console.log('MONOLITH MissionToolCoordinator active-step boundary regression PASS');
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
