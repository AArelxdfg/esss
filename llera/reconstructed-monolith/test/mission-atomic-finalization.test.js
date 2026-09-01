'use strict';

const assert = require('assert');
const { MissionEngine } = require('../src/mission-engine');

const clone = value => JSON.parse(JSON.stringify(value));

async function run() {
  let persisted = null;
  let now = 1000;
  let writes = 0;
  const save = async state => {
    writes += 1;
    persisted = clone(state);
  };
  const load = async () => persisted && clone(persisted);

  const engine = new MissionEngine({ load, save, now: () => ++now });
  await engine.init();

  const mission = await engine.createMission({
    title: 'Atomic finalize',
    goal: 'Do not replay a completed material step after a crash',
    mode: 'work',
    steps: [
      { id: 'mutate', name: 'Mutate' },
      { id: 'verify', name: 'Verify', dependencies: ['mutate'] }
    ]
  });

  await engine.startMission(mission.id);
  await engine.beginStep(mission.id, 'mutate');

  const beforeWrites = writes;
  const completed = await engine.completeStep(mission.id, 'mutate', { changed: true });
  assert.strictEqual(writes - beforeWrites, 1, 'completeStep must use a single persistence write');

  const step = completed.steps.find(s => s.id === 'mutate');
  const checkpoint = completed.checkpoints.find(c => c.id === step.checkpointId);
  assert(checkpoint);
  assert.strictEqual(step.status, 'completed');
  assert.strictEqual(checkpoint.currentStepId, null);
  assert(checkpoint.completedStepIds.includes('mutate'));
  assert.strictEqual(checkpoint.payload.type, 'step-complete');
  assert.strictEqual(checkpoint.stepAttempt, step.attempts);
  assert.strictEqual(checkpoint.stepStartedAt, step.startedAt);

  const legacy = clone(persisted);
  const legacyMission = legacy.missions[mission.id];
  const legacyStep = legacyMission.steps.find(s => s.id === 'mutate');
  legacyMission.status = 'running';
  legacyMission.currentStepId = 'mutate';
  legacyStep.status = 'running';
  legacyStep.completedAt = null;
  legacyStep.checkpointId = null;
  persisted = legacy;

  const restarted = new MissionEngine({ load, save, now: () => ++now });
  await restarted.init();
  const repaired = restarted.getMission(mission.id);
  const repairedStep = repaired.steps.find(s => s.id === 'mutate');

  assert.strictEqual(repairedStep.status, 'completed');
  assert.strictEqual(repairedStep.checkpointId, checkpoint.id);
  assert.strictEqual(repaired.currentStepId, null);
  assert.strictEqual(repaired.status, 'interrupted');
  assert.strictEqual(restarted.nextRunnableStep(mission.id), null);

  await restarted.startMission(mission.id);
  assert.strictEqual(restarted.nextRunnableStep(mission.id).id, 'verify');

  let persisted2 = null;
  let now2 = 2000;
  const save2 = async state => { persisted2 = clone(state); };
  const load2 = async () => persisted2 && clone(persisted2);
  const e2 = new MissionEngine({ load: load2, save: save2, now: () => ++now2 });
  await e2.init();
  const m2 = await e2.createMission({
    title:'No completion evidence',
    goal:'Retry actual interrupted step',
    steps:[{id:'work', name:'Work'}]
  });
  await e2.startMission(m2.id);
  await e2.beginStep(m2.id, 'work');

  const r2 = new MissionEngine({ load: load2, save: save2, now: () => ++now2 });
  await r2.init();
  const interrupted = r2.getMission(m2.id);
  assert.strictEqual(interrupted.status, 'interrupted');
  assert.strictEqual(interrupted.steps[0].status, 'pending');
  assert.strictEqual(interrupted.steps[0].lastError, 'interrupted:process-restart');

  console.log('MONOLITH mission atomic finalization PASS', {
    singleWriteCompletion: true,
    checkpointReflectsCompletedState: true,
    legacyCrashWindowReplaySafe: true,
    noEvidenceStillRetries: true
  });
}

run().catch(err => {
  console.error(err.stack || err);
  process.exit(1);
});
