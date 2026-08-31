'use strict';

const assert = require('assert');
const { MissionEngine } = require('../src/mission-engine');

function mission(id, createdAt, { status = 'pending', running = false } = {}) {
  return {
    id,
    title: id,
    goal: `recover ${id}`,
    mode: 'work',
    status: running ? 'running' : status,
    createdAt,
    updatedAt: createdAt,
    startedAt: running ? createdAt : null,
    completedAt: null,
    currentStepId: running ? `${id}-step` : null,
    resumeCount: 0,
    budget: { maxSteps: 1, maxAttemptsPerStep: 3 },
    steps: [{
      id: `${id}-step`,
      name: 'step',
      status: running ? 'running' : 'pending',
      dependencies: [],
      attempts: running ? 1 : 0,
      startedAt: running ? createdAt : null,
      completedAt: null,
      lastError: null,
      checkpointId: null
    }],
    checkpoints: [],
    toolTrace: []
  };
}

(async () => {
  let durable = {
    schema: 1,
    missions: {
      visible: mission('visible', 10),
      orphanRunning: mission('orphanRunning', 30, { running: true }),
      orphanNewer: mission('orphanNewer', 20)
    },
    order: ['missing', 'visible', 'visible']
  };

  const engine = new MissionEngine({
    load: async () => JSON.parse(JSON.stringify(durable)),
    save: async state => { durable = JSON.parse(JSON.stringify(state)); },
    now: () => 999
  });

  await engine.init();

  assert.deepEqual(
    durable.order,
    ['visible', 'orphanRunning', 'orphanNewer'],
    'order repair must drop missing/duplicate ids and append orphan missions deterministically'
  );

  assert.deepEqual(
    engine.listMissions().map(item => item.id),
    durable.order,
    'every persisted mission must remain discoverable after restart'
  );

  const recovered = engine.getMission('orphanRunning');
  assert.equal(recovered.status, 'interrupted');
  assert.equal(recovered.currentStepId, null);
  assert.equal(recovered.steps[0].status, 'pending');
  assert.equal(recovered.steps[0].lastError, 'interrupted:process-restart');
  assert.equal(durable.missions.orphanRunning.status, 'interrupted');

  console.log('MISSION_ORDER_ORPHAN_RECOVERY_PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
