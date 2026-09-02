'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { MonolithService } = require('../app/services/monolith-service.cjs');

test('MonolithService does not repeat a durably checkpointed step after torn crash state', async t => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'llera-monolith-durable-crash-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));

  const first = new MonolithService({ userData });
  await first.init();
  await first.createMission({
    title: 'Durable checkpoint crash recovery',
    goal: 'Do not repeat work already bound to a durable step-complete checkpoint.'
  });

  const created = first.snapshot().missions[0];
  await first.missions.startMission(created.id);
  const step = first.missions.nextRunnableStep(created.id);
  assert.ok(step?.id, 'mission must expose its first runnable step');

  await first.missions.beginStep(created.id, step.id);
  const running = first.missions.getMission(created.id);
  const runningStep = running.steps.find(candidate => candidate.id === step.id);
  const attempt = runningStep.attempts;
  const startedAt = runningStep.startedAt;

  await first.missions.completeStep(created.id, step.id, { accepted: true });
  const completed = first.missions.getMission(created.id);
  const completedStep = completed.steps.find(candidate => candidate.id === step.id);
  assert.equal(completedStep.status, 'completed');
  assert.ok(completedStep.checkpointId, 'completed step must have a durable checkpoint');

  const checkpoint = completed.checkpoints.find(candidate => candidate.id === completedStep.checkpointId);
  assert.equal(checkpoint.payload.type, 'step-complete');
  assert.equal(checkpoint.payload.stepId, step.id);
  assert.equal(checkpoint.stepAttempt, attempt);
  assert.equal(checkpoint.stepStartedAt, startedAt);

  // Simulate the narrow crash/torn-state window the recovery logic is designed for:
  // the durable completion checkpoint reached storage, but the persisted mission/step
  // status regressed to the pre-completion running view. Recovery must trust only a
  // checkpoint bound to the same step attempt/start tuple and must not repeat the step.
  const storePath = path.join(userData, 'missions.json');
  const persisted = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  const persistedMission = persisted.missions[created.id];
  const persistedStep = persistedMission.steps.find(candidate => candidate.id === step.id);
  persistedMission.status = 'running';
  persistedMission.currentStepId = step.id;
  persistedMission.completedAt = null;
  persistedStep.status = 'running';
  persistedStep.completedAt = null;
  persistedStep.lastError = null;
  persistedStep.attempts = attempt;
  persistedStep.startedAt = startedAt;
  fs.writeFileSync(storePath, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');

  const second = new MonolithService({ userData });
  await second.init();

  const recovered = second.missions.getMission(created.id);
  const recoveredStep = recovered.steps.find(candidate => candidate.id === step.id);
  assert.equal(recoveredStep.status, 'completed', 'durable completion must win over stale running state');
  assert.equal(recoveredStep.checkpointId, checkpoint.id);
  assert.equal(recoveredStep.lastError, null);
  assert.notEqual(second.missions.nextRunnableStep(created.id)?.id, step.id, 'durably completed step must never be scheduled again');

  const repairedStore = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  assert.equal(repairedStore.missions[created.id].steps.find(candidate => candidate.id === step.id).status, 'completed');
});