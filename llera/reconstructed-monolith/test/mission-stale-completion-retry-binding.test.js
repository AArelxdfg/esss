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
        title: 'stale completion retry binding',
        goal: 'never replay an old completion receipt onto a newer step attempt',
        mode: 'work',
        status: 'running',
        createdAt: 1,
        updatedAt: 30,
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
          attempts: 2,
          startedAt: 30,
          completedAt: null,
          lastError: null,
          checkpointId: null
        }],
        checkpoints: [{
          id: 'cp_old',
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
            result: { verified: true, receipt: 'stale-attempt-1' }
          }
        }],
        toolTrace: []
      }
    },
    order: ['m1']
  };

  let saved = null;
  const engine = new MissionEngine({
    load: async () => clone(persisted),
    save: async state => { saved = clone(state); },
    now: () => 40
  });

  await engine.init();

  const recovered = engine.getMission('m1');
  assert.strictEqual(recovered.status, 'interrupted');
  assert.strictEqual(recovered.currentStepId, null);
  assert.strictEqual(recovered.steps[0].status, 'pending');
  assert.strictEqual(recovered.steps[0].attempts, 2, 'restart must preserve the newer attempt counter');
  assert.strictEqual(recovered.steps[0].startedAt, 30, 'restart must preserve the newer attempt start binding');
  assert.strictEqual(recovered.steps[0].lastError, 'interrupted:process-restart');
  assert.strictEqual(recovered.steps[0].completedAt, null);
  assert.strictEqual(recovered.steps[0].checkpointId, null, 'stale receipt must not become the active completion checkpoint');
  assert.ok(saved, 'repaired interrupted state must be persisted');
  assert.strictEqual(saved.missions.m1.steps[0].status, 'pending');

  await engine.startMission('m1');
  const runnable = engine.nextRunnableStep('m1');
  assert.ok(runnable, 'the newer unfinished attempt must remain resumable');
  assert.strictEqual(runnable.id, 's1');
  assert.strictEqual(runnable.attempts, 2);

  console.log('mission stale completion retry binding PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
