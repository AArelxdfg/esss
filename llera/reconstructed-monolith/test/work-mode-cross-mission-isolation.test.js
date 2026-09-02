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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llera-work-isolation-'));
  const missions = persistentMissionEngine(path.join(root, 'missions.json'));
  await missions.init();

  const a = await missions.createMission({ title: 'A', goal: 'Write A', steps: ['write A'] });
  const b = await missions.createMission({ title: 'B', goal: 'Observe B', steps: ['observe B'] });
  const work = new WorkModeService({ missionEngine: missions, userData: root });

  await work.startMission(a.id);
  await work.beginNextStep(a.id);
  await work.startMission(b.id);
  await work.beginNextStep(b.id);

  const originalExecutor = work.runtime.guardedBroker.historicalExecutor;
  let releaseWrite;
  let writeEntered;
  const writeEnteredPromise = new Promise(resolve => { writeEntered = resolve; });
  const releaseWritePromise = new Promise(resolve => { releaseWrite = resolve; });

  work.runtime.guardedBroker.historicalExecutor = async (tool, args, context) => {
    if (tool === 'write_file' && context.missionId === a.id) {
      writeEntered();
      await releaseWritePromise;
    }
    return originalExecutor(tool, args, context);
  };

  const aStep = missions.getMission(a.id).currentStepId;
  const bStep = missions.getMission(b.id).currentStepId;
  const pendingWrite = work.invokeTool({
    missionId: a.id,
    stepId: aStep,
    tool: 'write_file',
    args: { path: 'a.txt', content: 'A' },
    materialAuthorization: true
  });

  await writeEnteredPromise;

  assert.throws(
    () => work.status(b.id),
    error => error && error.code === 'WORK_MODE_CROSS_MISSION_OPERATION_BUSY',
    'status for another mission must not restore the shared guard during an active tool operation'
  );

  const queuedObservation = work.invokeTool({
    missionId: b.id,
    stepId: bStep,
    tool: 'path_exists',
    args: { path: 'b.txt' }
  });

  releaseWrite();
  const written = await pendingWrite;
  const observed = await queuedObservation;

  assert.strictEqual(written.ok, true);
  assert.strictEqual(written.persistedTrace.material, true);
  assert.strictEqual(observed.ok, true);
  assert.strictEqual(observed.persistedTrace.observation, true);

  const aStatus = work.status(a.id);
  const bStatus = work.status(b.id);
  assert(aStatus.execution.verificationDebt, 'mission A must retain its own material verification debt');
  assert.strictEqual(bStatus.execution.verificationDebt, null, 'mission B observation must not clear mission A debt');

  const aTrace = missions.getMission(a.id).toolTrace;
  const bTrace = missions.getMission(b.id).toolTrace;
  assert.deepStrictEqual(aTrace.map(x => x.tool), ['write_file']);
  assert.deepStrictEqual(bTrace.map(x => x.tool), ['path_exists']);

  fs.rmSync(root, { recursive: true, force: true });
  console.log('MONOLITH Work Mode cross-mission isolation regression PASS');
})().catch(error => { console.error(error.stack || error); process.exit(1); });
