'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llera-work-mode-'));
  const missionFile = path.join(root, 'missions.json');
  const missions = persistentMissionEngine(missionFile);
  await missions.init();

  const mission = await missions.createMission({
    title: 'Real filesystem acceptance',
    goal: 'Create and independently re-observe a real workspace file',
    steps: ['Execute and verify material action']
  });

  const work = new WorkModeService({ missionEngine: missions, userData: root });
  await work.startMission(mission.id);
  await work.beginNextStep(mission.id);
  const active = missions.getMission(mission.id);
  assert(active.currentStepId, 'mission step must be active');

  const denied = await work.invokeTool({
    missionId: mission.id,
    stepId: active.currentStepId,
    tool: 'write_file',
    args: { path: 'acceptance/proof.txt', content: 'MONOLITH TEST' },
    materialAuthorization: false
  });
  assert.strictEqual(denied.blocked, true, 'material action must fail closed without explicit authorization');
  assert.strictEqual(denied.reason, 'action_authorization_denied');

  const written = await work.invokeTool({
    missionId: mission.id,
    stepId: active.currentStepId,
    tool: 'write_file',
    args: { path: 'acceptance/proof.txt', content: 'MONOLITH TEST' },
    materialAuthorization: true
  });
  assert.strictEqual(written.ok, true);
  assert.strictEqual(written.persisted, true);
  assert.strictEqual(written.persistedTrace.material, true);

  const target = path.join(root, 'workspace', 'acceptance', 'proof.txt');
  const bytes = fs.readFileSync(target);
  assert.strictEqual(bytes.toString('utf8'), 'MONOLITH TEST');
  const expectedSha = crypto.createHash('sha256').update(bytes).digest('hex');
  assert.strictEqual(written.result.sha256, expectedSha);

  let status = work.status(mission.id);
  assert(status.execution.verificationDebt, 'material write must open verification debt');

  const observed = await work.invokeTool({
    missionId: mission.id,
    stepId: active.currentStepId,
    tool: 'read_file',
    args: { path: 'acceptance/proof.txt' }
  });
  assert.strictEqual(observed.ok, true);
  assert.strictEqual(observed.result.text, 'MONOLITH TEST');
  assert.strictEqual(observed.persistedTrace.observation, true);

  status = work.status(mission.id);
  assert.strictEqual(status.execution.verificationDebt, null, 'independent re-observation must close verification debt');
  assert.strictEqual(status.execution.canFinalize, true);

  const completed = await work.completeCurrentStep(mission.id, { sha256: expectedSha });
  assert.strictEqual(completed.blocked, false);
  const finished = missions.getMission(mission.id);
  assert.strictEqual(finished.status, 'completed');
  assert(finished.toolTrace.some(entry => entry.tool === 'write_file' && entry.material === true));
  assert(finished.toolTrace.some(entry => entry.tool === 'read_file' && entry.observation === true));
  assert(finished.checkpoints.some(entry => entry.payload?.type === 'material-action'));
  assert(finished.checkpoints.some(entry => entry.payload?.type === 'verification'));

  const restoredEngine = persistentMissionEngine(missionFile);
  await restoredEngine.init();
  const restoredWork = new WorkModeService({ missionEngine: restoredEngine, userData: root });
  const restored = restoredWork.status(mission.id);
  assert.strictEqual(restored.mission.status, 'completed');
  assert.strictEqual(restored.execution.verificationDebt, null);
  assert.strictEqual(restored.coverage.declaredCount, 62);
  assert.strictEqual(restored.coverage.workspaceMode, 'workspace-scoped');
  assert.strictEqual(restored.coverage.physicalValidationClaimed, false);

  fs.rmSync(root, { recursive: true, force: true });
  console.log('MONOLITH product Work Mode bridge acceptance PASS', {
    realFilesystemMutation: true,
    materialAuthorizationFailClosed: true,
    independentReobservation: true,
    verificationDebtClosed: true,
    durableMissionTraceAndCheckpoint: true,
    restoredToolSurface: 62,
    physicalValidationClaimed: false
  });
})().catch(error => { console.error(error.stack || error); process.exit(1); });
