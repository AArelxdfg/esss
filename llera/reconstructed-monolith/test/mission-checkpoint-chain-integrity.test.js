'use strict';

const assert = require('node:assert');
const { MissionEngine } = require('../src/mission-engine');

const clone = value => JSON.parse(JSON.stringify(value));

function persistedMission() {
  return {
    id: 'mission-chain',
    title: 'Checkpoint chain integrity',
    goal: 'Reject a persisted checkpoint chain whose predecessor binding was rewritten',
    mode: 'work',
    status: 'paused',
    createdAt: 1,
    updatedAt: 6,
    startedAt: 2,
    completedAt: null,
    currentStepId: null,
    resumeCount: 0,
    budget: { maxSteps: 1, maxAttemptsPerStep: 3 },
    steps: [{
      id: 'step-chain',
      name: 'Material step',
      status: 'pending',
      dependencies: [],
      attempts: 1,
      startedAt: 3,
      completedAt: null,
      lastError: 'interrupted:user-pause',
      checkpointId: 'checkpoint-2'
    }],
    checkpoints: [
      {
        id: 'checkpoint-1',
        at: 4,
        status: 'running',
        currentStepId: 'step-chain',
        completedStepIds: [],
        previousCheckpointId: null,
        stepAttempt: 1,
        stepStartedAt: 3,
        payload: { type: 'material-action', stepId: 'step-chain' }
      },
      {
        id: 'checkpoint-2',
        at: 5,
        status: 'running',
        currentStepId: 'step-chain',
        completedStepIds: [],
        previousCheckpointId: 'forged-predecessor',
        stepAttempt: 1,
        stepStartedAt: 3,
        payload: { type: 'verification', stepId: 'step-chain' }
      }
    ],
    toolTrace: []
  };
}

(async () => {
  const raw = {
    schema: 1,
    missions: { 'mission-chain': persistedMission() },
    order: ['mission-chain']
  };
  let saveCalls = 0;
  const engine = new MissionEngine({
    load: async () => clone(raw),
    save: async () => { saveCalls += 1; }
  });

  await assert.rejects(
    () => engine.init(),
    error => error && /checkpoint chain mismatch/.test(error.message),
    'tampered predecessor binding must fail closed during durable mission restore'
  );
  assert.strictEqual(saveCalls, 0, 'corrupt checkpoint state must never be persisted as repaired state');
  assert.deepStrictEqual(
    engine.snapshot(),
    { schema: 1, missions: {}, order: [] },
    'corrupt durable input must not leak into the live mission state'
  );

  console.log('mission checkpoint chain integrity regression PASS', {
    forgedPredecessorRejected: true,
    corruptStateNotPersisted: true,
    corruptStateNotExposed: true
  });
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
