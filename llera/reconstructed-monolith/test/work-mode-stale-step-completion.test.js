'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MissionEngine } = require('../src/mission-engine');
const { WorkModeService } = require('../app/services/work-mode-service.cjs');

function persistentMissionEngine(file) {
  return new MissionEngine({
    load: async () => {
      try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
      catch (_) { return null; }
    },
    save: async value => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(value, null, 2));
    }
  });
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llera-stale-complete-'));
  try {
    const missions = persistentMissionEngine(path.join(root, 'missions.json'));
    await missions.init();
    const mission = await missions.createMission({
      title: 'Stale completion guard',
      goal: 'Never let an old renderer request complete a newer active step',
      steps: ['first', 'second']
    });
    const work = new WorkModeService({ missionEngine: missions, userData: root });

    await work.startMission(mission.id);
    await work.beginNextStep(mission.id);
    const firstStepId = missions.getMission(mission.id).currentStepId;
    assert(firstStepId, 'first step must be active');

    const firstCompletion = await work.completeCurrentStep(mission.id, firstStepId, { phase: 1 });
    assert.strictEqual(firstCompletion.blocked, false);

    await work.beginNextStep(mission.id);
    const beforeStale = missions.getMission(mission.id);
    const secondStepId = beforeStale.currentStepId;
    assert(secondStepId && secondStepId !== firstStepId, 'second step must now be active');

    await assert.rejects(
      () => work.completeCurrentStep(mission.id, firstStepId, { stale: true }),
      error => error && error.code === 'WORK_MODE_STEP_MISMATCH'
    );

    const afterStale = missions.getMission(mission.id);
    assert.strictEqual(afterStale.currentStepId, secondStepId, 'stale completion must not move the active step');
    assert.strictEqual(afterStale.status, 'running');
    assert.strictEqual(afterStale.steps.find(step => step.id === secondStepId).status, 'running');
    assert.strictEqual(afterStale.steps.find(step => step.id === firstStepId).status, 'completed');
    assert.strictEqual(afterStale.checkpoints.filter(item => item.payload?.type === 'step-complete').length, 1, 'stale completion must not append a second completion checkpoint');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('MONOLITH Work Mode stale step completion regression PASS');
})().catch(error => { console.error(error.stack || error); process.exit(1); });
