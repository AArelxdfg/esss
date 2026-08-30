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

  console.log('MISSION_ORPHAN_RUNNING_RECOVERY_PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
