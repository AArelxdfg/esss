'use strict';

const assert = require('assert');
const { MissionEngine } = require('../src/mission-engine');

const clone = value => JSON.parse(JSON.stringify(value));

(async () => {
  const persisted = {
    schema: 1,
    missions: {
      m1: {
        id: 'm1',
        title: 'durable completion recovery',
        goal: 'never replay an already durably completed material step',
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
          payload: {
            type: 'step-complete',
            stepId: 's1',
            result: { verified: true }
          }
        }],
        toolTrace: []
      }
    },
    order: ['m1']
  };

  let repaired = null;
  const engine = new MissionEngine({
    load: async () => clone(persisted),
    save: async state => { repaired = clone(state); },
    now: () => 30
  });

  await engine.init();

  const mission = engine.getMission('m1');
  assert.strictEqual(mission.status, 'completed', 'durably completed step must recover as completed mission');
  assert.strictEqual(mission.currentStepId, null, 'recovered mission must not retain an active step');
  assert.strictEqual(mission.steps[0].status, 'completed', 'durable completion checkpoint must win over stale running state');
  assert.strictEqual(mission.steps[0].checkpointId, 'cp1', 'recovered step must bind to the durable completion checkpoint');
  assert.strictEqual(mission.steps[0].completedAt, 20, 'completion timestamp must be restored from durable checkpoint');
  assert.strictEqual(engine.nextRunnableStep('m1'), null, 'completed material step must not become runnable again after restart');
  assert.ok(repaired, 'repaired state must be persisted');
  assert.strictEqual(repaired.missions.m1.status, 'completed');
  assert.strictEqual(repaired.missions.m1.steps[0].status, 'completed');

  console.log('mission durable completion recovery contract PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
