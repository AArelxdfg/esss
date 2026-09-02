'use strict';

const assert = require('assert');
const { MissionEngine } = require('../src/mission-engine');
const { MissionToolCoordinator } = require('../src/mission-tool-coordinator');

(async () => {
  let persisted = null;
  let now = 5000;
  const engine = new MissionEngine({
    load: async () => persisted,
    save: async state => { persisted = JSON.parse(JSON.stringify(state)); },
    now: () => ++now
  });
  await engine.init();
  const mission = await engine.createMission({
    title: 'Step binding regression',
    goal: 'Prevent tool traces and material actions from being bound to a spoofed mission step',
    mode: 'work',
    steps: [
      { id: 's1', name: 'active step' },
      { id: 's2', name: 'later step', dependencies: ['s1'] }
    ]
  });
  await engine.startMission(mission.id);
  await engine.beginStep(mission.id, 's1');

  let invokeCount = 0;
  const broker = {
    guard: { classify: () => ({ material: true, observation: false }) },
    restore: () => ({ canFinalize: true }),
    status: () => ({ canFinalize: true, verificationDebt: null }),
    invoke: async () => {
      invokeCount += 1;
      return {
        ok: true,
        blocked: false,
        verificationDebt: null,
        trace: { material: true, observation: false, scope: 'path:x.txt' }
      };
    }
  };
  const coordinator = new MissionToolCoordinator({ missionEngine: engine, broker });

  await assert.rejects(
    () => coordinator.invoke({ missionId: mission.id, stepId: 's2', tool: 'write_file', args: { path: 'x.txt' } }),
    /mission step binding mismatch/
  );
  await assert.rejects(
    () => coordinator.invoke({ missionId: mission.id, stepId: 'ghost', tool: 'write_file', args: { path: 'x.txt' } }),
    /unknown mission step ghost/
  );
  await assert.rejects(
    () => coordinator.invoke({ missionId: mission.id, stepId: '', tool: 'write_file', args: { path: 'x.txt' } }),
    /stepId must be a non-empty string/
  );

  assert.strictEqual(invokeCount, 0, 'invalid step bindings must fail before any tool side effect');
  let current = engine.getMission(mission.id);
  assert.strictEqual(current.toolTrace.length, 0, 'invalid bindings must not persist a tool trace');
  assert.strictEqual(current.checkpoints.length, 0, 'invalid bindings must not create checkpoints');
  assert.strictEqual(current.currentStepId, 's1');

  const valid = await coordinator.invoke({
    missionId: mission.id,
    stepId: 's1',
    tool: 'write_file',
    args: { path: 'x.txt' }
  });
  assert.strictEqual(valid.ok, true);
  assert.strictEqual(valid.stepId, 's1');
  assert.strictEqual(valid.persistedTrace.stepId, 's1');
  assert.strictEqual(invokeCount, 1);

  current = engine.getMission(mission.id);
  assert.strictEqual(current.toolTrace.length, 1);
  assert.strictEqual(current.toolTrace[0].stepId, 's1');
  assert.strictEqual(current.checkpoints.length, 1);
  assert.strictEqual(current.checkpoints[0].payload.stepId, 's1');

  console.log('mission tool step binding PASS', {
    spoofedStepBlocked: true,
    unknownStepBlocked: true,
    emptyStepBlocked: true,
    sideEffectPreventedBeforeBroker: true,
    traceBoundToActiveStep: true
  });
})().catch(error => {
  console.error(error);
  process.exit(1);
});
