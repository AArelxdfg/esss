'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { MonolithService } = require('../app/services/monolith-service.cjs');

test('MonolithService persists missions and repairs interrupted work across restart', async t => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'llera-monolith-mission-restart-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));

  const first = new MonolithService({ userData });
  await first.init();
  await first.createMission({
    title: 'Restart recovery acceptance',
    goal: 'Persist mission state and resume unfinished work after process restart.'
  });

  const created = first.snapshot().missions[0];
  assert.ok(created?.id, 'mission must be visible through the real product service snapshot');
  assert.equal(created.status, 'pending');
  assert.equal(created.steps.length, 3);

  await first.missions.startMission(created.id);
  const runnable = first.missions.nextRunnableStep(created.id);
  assert.ok(runnable?.id, 'running mission must expose a runnable step');
  await first.missions.beginStep(created.id, runnable.id);

  const beforeRestart = first.missions.getMission(created.id);
  assert.equal(beforeRestart.status, 'running');
  assert.equal(beforeRestart.currentStepId, runnable.id);
  assert.equal(beforeRestart.steps.find(step => step.id === runnable.id).status, 'running');

  // Simulate a process restart by constructing the actual product service again
  // against the same persisted userData directory. MissionEngine.init() must
  // repair any in-flight step so it can be resumed instead of being stranded.
  const second = new MonolithService({ userData });
  await second.init();

  const recovered = second.missions.getMission(created.id);
  assert.equal(recovered.status, 'interrupted');
  assert.equal(recovered.currentStepId, null);
  const recoveredStep = recovered.steps.find(step => step.id === runnable.id);
  assert.equal(recoveredStep.status, 'pending');
  assert.equal(recoveredStep.lastError, 'interrupted:process-restart');

  const productSnapshot = second.snapshot();
  assert.ok(productSnapshot.missions.some(mission => mission.id === created.id), 'recovered mission must remain visible to the renderer/product surface');

  await second.missions.startMission(created.id);
  const resumed = second.missions.getMission(created.id);
  assert.equal(resumed.status, 'running');
  assert.equal(resumed.resumeCount, 1);
  assert.equal(second.missions.nextRunnableStep(created.id).id, runnable.id, 'unfinished step must be runnable again after recovery');

  const persisted = JSON.parse(fs.readFileSync(path.join(userData, 'missions.json'), 'utf8'));
  assert.equal(persisted.missions[created.id].status, 'running');
  assert.equal(persisted.missions[created.id].resumeCount, 1);
});
