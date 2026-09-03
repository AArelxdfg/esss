'use strict';

const assert = require('assert');
const { MissionEngine } = require('../src/mission-engine');

const clone = value => JSON.parse(JSON.stringify(value));

function persistedMission() {
  return {
    id: 'm1',
    title: 'checkpoint binding',
    goal: 'never trust contradictory durable completion facts',
    mode: 'work',
    status: 'running',
    createdAt: 1,
    updatedAt: 20,
    startedAt: 10,
    completedAt: null,
    currentStepId: 's1',
    resumeCount: 0,
    budget: { maxSteps: 1, maxAttemptsPerStep: 3 },
    steps: [{
      id: 's1',
      name: 'material action',
      status: 'running',
      dependencies: [],
      attempts: 1,
      startedAt: 10,
      completedAt: null,
      lastError: null,
      checkpointId: null
    }],
    checkpoints: [{
      id: 'cp1',
      at: 20,
      status: 'completed',
      currentStepId: null,
      completedStepIds: ['s1'],
      previousCheckpointId: null,
      stepAttempt: 1,
      stepStartedAt: 10,
      payload: { type: 'step-complete', stepId: 's1', result: { verified: true } }
    }],
    toolTrace: []
  };
}

async function rejectMutation(mutator, pattern) {
  const mission = persistedMission();
  mutator(mission);
  let saves = 0;
  const engine = new MissionEngine({
    load: async () => ({ schema: 1, missions: { m1: clone(mission) }, order: ['m1'] }),
    save: async () => { saves += 1; },
    now: () => 30
  });
  await assert.rejects(() => engine.init(), pattern);
  assert.strictEqual(saves, 0, 'contradictory completion checkpoint must not be accepted or rewritten');
}

(async () => {
  await rejectMutation(
    mission => { mission.checkpoints[0].completedStepIds = []; },
    /invalid step-complete checkpoint binding/
  );
  await rejectMutation(
    mission => { mission.checkpoints[0].payload.stepId = 'missing'; },
    /invalid step-complete checkpoint binding/
  );
  await rejectMutation(
    mission => { mission.checkpoints[0].stepAttempt = 0; },
    /invalid step-complete checkpoint runtime binding/
  );
  await rejectMutation(
    mission => { mission.checkpoints[0].stepStartedAt = null; },
    /invalid step-complete checkpoint runtime binding/
  );

  let repaired = null;
  const valid = persistedMission();
  const engine = new MissionEngine({
    load: async () => ({ schema: 1, missions: { m1: clone(valid) }, order: ['m1'] }),
    save: async state => { repaired = clone(state); },
    now: () => 30
  });
  await engine.init();
  assert.strictEqual(engine.getMission('m1').status, 'completed');
  assert.strictEqual(engine.getMission('m1').steps[0].status, 'completed');
  assert.strictEqual(engine.nextRunnableStep('m1'), null);
  assert.ok(repaired, 'valid completion checkpoint should still recover durably');

  console.log('mission step-complete checkpoint binding PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
