'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MissionEngine } = require('../src/mission-engine');
const { WorkModeService } = require('../app/services/work-mode-service.cjs');

test('Work Mode pause persists active step as retryable and resumes deterministically', async () => {
  let persisted = null;
  const engine = new MissionEngine({
    load: async () => persisted,
    save: async state => { persisted = JSON.parse(JSON.stringify(state)); },
    now: (() => { let now = 1000; return () => ++now; })()
  });
  await engine.init();

  const mission = await engine.createMission({
    title: 'Pause recovery',
    goal: 'Preserve the active Work Mode step across pause/resume',
    steps: [{ id: 'step_one', name: 'Do one safe action' }]
  });

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'llera-work-pause-'));
  try {
    const events = [];
    const service = new WorkModeService({ missionEngine: engine, userData, onEvent: event => events.push(event) });

    await service.startMission(mission.id);
    await service.beginNextStep(mission.id);
    const running = engine.getMission(mission.id);
    assert.equal(running.status, 'running');
    assert.equal(running.currentStepId, 'step_one');
    assert.equal(running.steps[0].status, 'running');
    assert.equal(running.steps[0].attempts, 1);

    const paused = await service.pauseMission(mission.id, 'acceptance-pause');
    assert.equal(paused.mission.status, 'paused');
    assert.equal(paused.mission.currentStepId, null);
    assert.equal(paused.mission.steps[0].status, 'pending');
    assert.equal(paused.mission.steps[0].lastError, 'interrupted:acceptance-pause');
    assert.equal(persisted.missions[mission.id].status, 'paused');
    assert.equal(persisted.missions[mission.id].steps[0].status, 'pending');
    assert.ok(events.some(event => event.type === 'mission.paused' && event.detail.missionId === mission.id));

    await service.startMission(mission.id);
    await service.beginNextStep(mission.id);
    const resumed = engine.getMission(mission.id);
    assert.equal(resumed.status, 'running');
    assert.equal(resumed.currentStepId, 'step_one');
    assert.equal(resumed.steps[0].status, 'running');
    assert.equal(resumed.steps[0].attempts, 2);
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
