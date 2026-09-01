'use strict';

const assert = require('assert');
const { MissionEngine } = require('../src/mission-engine');
const { GuardedMonolithToolBroker } = require('../src/guarded-tool-broker');
const { MissionToolCoordinator } = require('../src/mission-tool-coordinator');

(async () => {
  let persistedMissionState = null;
  let now = 1000;
  const engine = new MissionEngine({
    load: async () => persistedMissionState,
    save: async state => { persistedMissionState = JSON.parse(JSON.stringify(state)); },
    now: () => ++now
  });
  await engine.init();
  const mission = await engine.createMission({
    title: 'Durable broker bridge',
    goal: 'Persist guarded material actions and their verification across restart',
    mode: 'work',
    steps: [{ id: 's1', name: 'execute and verify' }]
  });
  await engine.startMission(mission.id);
  await engine.beginStep(mission.id, 's1');

  const executor = async (tool, args) => {
    if (tool === 'write_file') return { written: args.path };
    if (tool === 'read_file') return { text: 'verified bytes' };
    throw new Error(`unexpected historical tool ${tool}`);
  };
  const snapshots = [];
  const broker = new GuardedMonolithToolBroker({ historicalExecutor: executor, actionAuthorizer:async () => true });
  const coordinator = new MissionToolCoordinator({
    missionEngine: engine,
    broker,
    recoverySnapshots: { create: async input => snapshots.push(JSON.parse(JSON.stringify(input))) }
  });

  const write = await coordinator.invoke({
    missionId: mission.id,
    tool: 'write_file',
    args: { path: 'x.txt', text: 'hello' }
  });
  assert.strictEqual(write.ok, true);
  assert.strictEqual(write.persisted, true);
  assert.strictEqual(write.persistedTrace.material, true);
  assert.strictEqual(write.persistedTrace.verification, false);
  assert.strictEqual(write.persistedTrace.scope, 'path:x.txt');
  assert.strictEqual(write.checkpoint.payload.type, 'material-action');
  assert.strictEqual(coordinator.canFinalize(mission.id), false);

  const blocked = await coordinator.invoke({
    missionId: mission.id,
    tool: 'write_file',
    args: { path: 'y.txt', text: 'must-block' }
  });
  assert.strictEqual(blocked.blocked, true);
  assert.strictEqual(blocked.reason, 'verification_debt_open');
  assert.strictEqual(engine.getMission(mission.id).toolTrace.length, 1);

  const verify = await coordinator.invoke({
    missionId: mission.id,
    tool: 'read_file',
    args: { path: 'x.txt' }
  });
  assert.strictEqual(verify.ok, true);
  assert.strictEqual(verify.persistedTrace.verification, true);
  assert.strictEqual(verify.persistedTrace.scope, 'path:x.txt');
  assert.strictEqual(verify.checkpoint.payload.type, 'verification');
  assert.strictEqual(coordinator.canFinalize(mission.id), true);

  // Simulate a new process with state loaded from durable MissionEngine persistence.
  const restartedEngine = new MissionEngine({
    load: async () => JSON.parse(JSON.stringify(persistedMissionState)),
    save: async state => { persistedMissionState = JSON.parse(JSON.stringify(state)); },
    now: () => ++now
  });
  await restartedEngine.init();
  const restartedCoordinator = new MissionToolCoordinator({
    missionEngine: restartedEngine,
    broker: new GuardedMonolithToolBroker({ historicalExecutor: executor, actionAuthorizer:async () => true })
  });
  assert.strictEqual(restartedCoordinator.canFinalize(mission.id), true);

  const restored = restartedEngine.getMission(mission.id);
  assert.strictEqual(restored.toolTrace.length, 2);
  assert.strictEqual(restored.checkpoints.length, 2);
  assert.strictEqual(snapshots.length, 2);

  console.log('mission-tool durable broker bridge PASS', {
    traceCount: restored.toolTrace.length,
    checkpoints: restored.checkpoints.length,
    recoverySnapshots: snapshots.length,
    restartRecovered: true
  });
})().catch(error => {
  console.error(error);
  process.exit(1);
});
