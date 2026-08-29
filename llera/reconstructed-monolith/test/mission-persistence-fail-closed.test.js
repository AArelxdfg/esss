'use strict';

const assert = require('assert');
const { MissionEngine } = require('../src/mission-engine');

async function exerciseMode(mode) {
  let persisted = null;
  let failSave = false;
  let now = mode === 'work' ? 1000 : 2000;
  const save = async state => {
    if (failSave) throw new Error('simulated persistence failure');
    persisted = JSON.parse(JSON.stringify(state));
  };
  const load = async () => persisted && JSON.parse(JSON.stringify(persisted));

  const engine = new MissionEngine({ load, save, now: () => ++now });
  await engine.init();
  const mission = await engine.createMission({
    title: `${mode} durable persistence`,
    goal: 'Reject ghost mission state when persistence fails',
    mode,
    steps: [{ id: 'only', name: 'Only step' }]
  });
  await engine.startMission(mission.id);
  await engine.beginStep(mission.id, 'only');

  const durableBeforeCheckpoint = JSON.parse(JSON.stringify(persisted));
  failSave = true;
  await assert.rejects(
    () => engine.checkpoint(mission.id, { type: 'manual', note: 'must-not-ghost' }),
    /simulated persistence failure/
  );
  let current = engine.getMission(mission.id);
  assert.equal(current.checkpoints.length, 0, `${mode}: failed checkpoint leaked into memory`);
  assert.equal(current.steps[0].checkpointId, null, `${mode}: failed checkpoint id leaked into step`);
  assert.deepStrictEqual(engine.snapshot(), durableBeforeCheckpoint, `${mode}: engine did not roll back to durable state`);

  failSave = false;
  const checkpoint = await engine.checkpoint(mission.id, { type: 'manual', note: 'durable' });
  current = engine.getMission(mission.id);
  assert.equal(current.checkpoints.length, 1);
  assert.equal(current.steps[0].checkpointId, checkpoint.id);

  const durableBeforeCompletion = JSON.parse(JSON.stringify(persisted));
  failSave = true;
  await assert.rejects(
    () => engine.completeStep(mission.id, 'only', { ok: true }),
    /simulated persistence failure/
  );
  current = engine.getMission(mission.id);
  assert.equal(current.status, 'running', `${mode}: failed completion changed mission status`);
  assert.equal(current.currentStepId, 'only', `${mode}: failed completion cleared active step`);
  assert.equal(current.steps[0].status, 'running', `${mode}: failed completion changed step status`);
  assert.equal(current.steps[0].completedAt, null, `${mode}: failed completion leaked completedAt`);
  assert.equal(current.checkpoints.length, 1, `${mode}: failed completion leaked step-complete checkpoint`);
  assert.deepStrictEqual(engine.snapshot(), durableBeforeCompletion, `${mode}: completion rollback diverged from durable state`);

  failSave = false;
  const completed = await engine.completeStep(mission.id, 'only', { ok: true });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.steps[0].status, 'completed');
  assert.equal(completed.checkpoints.length, 2);
  assert.equal(completed.checkpoints[1].payload.type, 'step-complete');

  const restarted = new MissionEngine({ load, save, now: () => ++now });
  await restarted.init();
  const recovered = restarted.getMission(mission.id);
  assert.equal(recovered.status, 'completed');
  assert.equal(recovered.currentStepId, null);
  assert.equal(recovered.steps[0].status, 'completed');
  assert.equal(recovered.checkpoints.length, 2);
  return { mode, missionId: mission.id, checkpointCount: recovered.checkpoints.length };
}

(async () => {
  const work = await exerciseMode('work');
  const conversation = await exerciseMode('conversation');
  console.log(JSON.stringify({
    pass: true,
    persistenceFailureFailClosed: true,
    ghostCheckpointGuard: true,
    ghostCompletionGuard: true,
    work,
    conversation
  }));
})().catch(err => {
  console.error(err.stack || err);
  process.exit(1);
});
