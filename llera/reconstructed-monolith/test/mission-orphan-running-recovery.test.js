'use strict';

const assert = require('assert');
const { MissionEngine } = require('../src/mission-engine');

async function recover(persisted) {
  let durable = JSON.parse(JSON.stringify(persisted));
  const engine = new MissionEngine({
    load: async () => JSON.parse(JSON.stringify(durable)),
    save: async state => { durable = JSON.parse(JSON.stringify(state)); },
    now: () => 9000
  });
  await engine.init();
  return { engine, durable };
}

(async () => {
  const baseMission = {
    id: 'm1', title: 'restore', goal: 'resume safely', mode: 'work', status: 'running',
    createdAt: 1, updatedAt: 2, startedAt: 2, completedAt: null, currentStepId: null,
    resumeCount: 0, budget: { maxSteps: 2, maxAttemptsPerStep: 3 },
    steps: [
      { id: 's1', name: 'material action', status: 'running', dependencies: [], attempts: 1, startedAt: 2, completedAt: null, lastError: null, checkpointId: null },
      { id: 's2', name: 'verify', status: 'pending', dependencies: ['s1'], attempts: 0, startedAt: null, completedAt: null, lastError: null, checkpointId: null }
    ], checkpoints: [], toolTrace: []
  };

  const interrupted = await recover({ schema: 1, missions: { m1: baseMission }, order: ['m1'] });
  const repaired = interrupted.engine.getMission('m1');
  assert.equal(repaired.status, 'interrupted');
  assert.equal(repaired.currentStepId, null);
  assert.equal(repaired.steps[0].status, 'pending');
  assert.equal(repaired.steps[0].lastError, 'interrupted:process-restart');

  const completedMission = JSON.parse(JSON.stringify(baseMission));
  completedMission.checkpoints.push({
    id: 'cp-complete', at: 77, status: 'running', currentStepId: null,
    completedStepIds: ['s1'], payload: { type: 'step-complete', stepId: 's1', result: { ok: true } }
  });
  const replayed = await recover({ schema: 1, missions: { m1: completedMission }, order: ['m1'] });
  const afterReplay = replayed.engine.getMission('m1');
  assert.equal(afterReplay.steps[0].status, 'completed');
  assert.equal(afterReplay.steps[0].checkpointId, 'cp-complete');
  assert.equal(afterReplay.steps[0].completedAt, 77);
  assert.equal(afterReplay.status, 'interrupted');

  const staleAttempt = JSON.parse(JSON.stringify(baseMission));
  staleAttempt.steps[0].attempts = 2;
  staleAttempt.steps[0].startedAt = 100;
  staleAttempt.checkpoints.push({
    id: 'cp-old-attempt', at: 77, status: 'running', currentStepId: null,
    completedStepIds: ['s1'], payload: { type: 'step-complete', stepId: 's1', attempt: 1, startedAt: 2, result: { ok: true } }
  });
  const staleRejected = await recover({ schema: 1, missions: { m1: staleAttempt }, order: ['m1'] });
  const afterStale = staleRejected.engine.getMission('m1');
  assert.equal(afterStale.steps[0].status, 'pending');
  assert.equal(afterStale.steps[0].completedAt, null);
  assert.equal(afterStale.steps[0].lastError, 'interrupted:process-restart');
  assert.equal(afterStale.status, 'interrupted');

  const matchingAttempt = JSON.parse(JSON.stringify(baseMission));
  matchingAttempt.steps[0].attempts = 2;
  matchingAttempt.steps[0].startedAt = 100;
  matchingAttempt.checkpoints.push({
    id: 'cp-attempt-2', at: 120, status: 'running', currentStepId: null,
    completedStepIds: ['s1'], payload: { type: 'step-complete', stepId: 's1', attempt: 2, startedAt: 100, result: { ok: true } }
  });
  const matchingReplay = await recover({ schema: 1, missions: { m1: matchingAttempt }, order: ['m1'] });
  const afterMatching = matchingReplay.engine.getMission('m1');
  assert.equal(afterMatching.steps[0].status, 'completed');
  assert.equal(afterMatching.steps[0].checkpointId, 'cp-attempt-2');
  assert.equal(afterMatching.steps[0].completedAt, 120);

  const missingCompletedBinding = JSON.parse(JSON.stringify(baseMission));
  missingCompletedBinding.steps[0].attempts = 2;
  missingCompletedBinding.steps[0].startedAt = 100;
  missingCompletedBinding.checkpoints.push({
    id: 'cp-missing-completed-binding', at: 120, status: 'running', currentStepId: null,
    completedStepIds: [], payload: { type: 'step-complete', stepId: 's1', attempt: 2, startedAt: 100, result: { ok: true } }
  });
  const missingBindingRejected = await recover({ schema: 1, missions: { m1: missingCompletedBinding }, order: ['m1'] });
  assert.equal(missingBindingRejected.engine.getMission('m1').steps[0].status, 'pending');

  const activeStepCheckpoint = JSON.parse(JSON.stringify(baseMission));
  activeStepCheckpoint.steps[0].attempts = 2;
  activeStepCheckpoint.steps[0].startedAt = 100;
  activeStepCheckpoint.checkpoints.push({
    id: 'cp-still-active', at: 120, status: 'running', currentStepId: 's1',
    completedStepIds: ['s1'], payload: { type: 'step-complete', stepId: 's1', attempt: 2, startedAt: 100, result: { ok: true } }
  });
  const activeRejected = await recover({ schema: 1, missions: { m1: activeStepCheckpoint }, order: ['m1'] });
  assert.equal(activeRejected.engine.getMission('m1').steps[0].status, 'pending');

  const missingStartedBinding = JSON.parse(JSON.stringify(baseMission));
  missingStartedBinding.steps[0].attempts = 2;
  missingStartedBinding.steps[0].startedAt = 100;
  missingStartedBinding.checkpoints.push({
    id: 'cp-missing-started-at', at: 120, status: 'running', currentStepId: null,
    completedStepIds: ['s1'], payload: { type: 'step-complete', stepId: 's1', attempt: 2, result: { ok: true } }
  });
  const missingStartedRejected = await recover({ schema: 1, missions: { m1: missingStartedBinding }, order: ['m1'] });
  assert.equal(missingStartedRejected.engine.getMission('m1').steps[0].status, 'pending');

  console.log('MISSION_COMPLETION_CHECKPOINT_CONSISTENCY_PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
