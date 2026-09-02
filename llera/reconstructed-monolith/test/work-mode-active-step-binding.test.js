'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MissionEngine } = require('../src/mission-engine');
const { WorkModeService } = require('../app/services/work-mode-service.cjs');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llera-work-step-bind-'));
  try {
    const missions = new MissionEngine();
    await missions.init();
    const mission = await missions.createMission({
      title: 'Active step binding',
      goal: 'Reject stale or forged step-bound tool calls',
      steps: ['First step', 'Second step']
    });

    const work = new WorkModeService({ missionEngine: missions, userData: root });
    await work.startMission(mission.id);
    await work.beginNextStep(mission.id);
    const running = missions.getMission(mission.id);
    assert(running.currentStepId, 'mission must expose an active step');

    const forgedStepId = running.steps.find(step => step.id !== running.currentStepId).id;
    await assert.rejects(
      () => work.invokeTool({
        missionId: mission.id,
        stepId: forgedStepId,
        tool: 'write_file',
        args: { path: 'forged.txt', content: 'MUST NOT EXIST' },
        materialAuthorization: true
      }),
      error => error && error.code === 'WORK_MODE_STEP_MISMATCH'
    );

    assert.strictEqual(fs.existsSync(path.join(root, 'workspace', 'forged.txt')), false,
      'mismatched-step material action must not touch the filesystem');

    const after = missions.getMission(mission.id);
    assert.strictEqual(after.currentStepId, running.currentStepId,
      'rejected call must not advance or rewrite the active mission step');
    assert.strictEqual(after.toolTrace.length, running.toolTrace.length,
      'rejected call must not create a durable tool trace');

    console.log('Work Mode active-step binding PASS', {
      failClosed: true,
      materialMutationPrevented: true,
      durableTraceUnchanged: true
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.stack || error); process.exit(1); });
