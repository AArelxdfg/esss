'use strict';

const assert = require('assert');
const { MissionEngine } = require('../src/mission-engine');

const clone = value => JSON.parse(JSON.stringify(value));

function pendingMission(id = 'm1') {
  return {
    id,
    title: 'persisted mission',
    goal: 'survive restart safely',
    mode: 'work',
    status: 'pending',
    createdAt: 1,
    updatedAt: 1,
    startedAt: null,
    completedAt: null,
    currentStepId: null,
    resumeCount: 0,
    budget: { maxSteps: 1, maxAttemptsPerStep: 3 },
    steps: [{
      id: 's1', name: 'step', status: 'pending', dependencies: [], attempts: 0,
      startedAt: null, completedAt: null, lastError: null, checkpointId: null
    }],
    checkpoints: [],
    toolTrace: []
  };
}

async function rejectPersistedMutation(mutator, pattern) {
  const mission = pendingMission();
  mutator(mission);
  let saves = 0;
  const engine = new MissionEngine({
    load: async () => ({ schema: 1, missions: { m1: clone(mission) }, order: ['m1'] }),
    save: async () => { saves += 1; }
  });
  await assert.rejects(() => engine.init(), pattern);
  assert.strictEqual(saves, 0, 'corrupt durable state must never be rewritten as accepted state');
  assert.deepStrictEqual(engine.snapshot(), { schema: 1, missions: {}, order: [] });
}

(async () => {
  const engine = new MissionEngine({ load: async () => null, save: async () => {} });
  await engine.init();

  for (const bad of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
    await assert.rejects(
      () => engine.createMission({ title: 'bad-budget', goal: 'reject', steps: ['one'], budget: { maxAttemptsPerStep: bad } }),
      /positive safe integers/
    );
  }
  await assert.rejects(
    () => engine.createMission({ title: 'bad-max-steps', goal: 'reject', steps: ['one'], budget: { maxSteps: 1.5 } }),
    /positive safe integers/
  );

  await rejectPersistedMutation(m => { m.status = 'teleported'; }, /invalid mission mode\/status/);
  await rejectPersistedMutation(m => { m.mode = 'demo-shell'; }, /invalid mission mode\/status/);
  await rejectPersistedMutation(m => { m.resumeCount = -1; }, /invalid resume count/);
  await rejectPersistedMutation(m => { m.budget.maxAttemptsPerStep = 0; }, /invalid mission budget/);
  await rejectPersistedMutation(m => { m.budget.maxSteps = 0; }, /invalid mission budget/);
  await rejectPersistedMutation(m => { m.currentStepId = 'missing-step'; }, /invalid current step id/);
  await rejectPersistedMutation(m => { m.steps[0].status = 'ghost'; }, /invalid step runtime state/);
  await rejectPersistedMutation(m => { m.steps[0].attempts = 4; }, /invalid step runtime state/);
  await rejectPersistedMutation(m => {
    m.checkpoints.push({
      id: 'cp1', at: 2, status: 'pending', currentStepId: 'missing-step', completedStepIds: [],
      previousCheckpointId: null, stepAttempt: null, stepStartedAt: null, payload: { type: 'manual' }
    });
  }, /invalid checkpoint current step/);
  await rejectPersistedMutation(m => {
    m.checkpoints.push({
      id: 'cp1', at: 2, status: 'pending', currentStepId: null, completedStepIds: ['missing-step'],
      previousCheckpointId: null, stepAttempt: null, stepStartedAt: null, payload: { type: 'manual' }
    });
  }, /invalid checkpoint completed step ids/);

  const accepted = pendingMission('running');
  accepted.id = 'running';
  accepted.steps[0].id = 'running-step';
  accepted.status = 'running';
  accepted.currentStepId = 'running-step';
  accepted.steps[0].status = 'running';
  accepted.steps[0].attempts = 1;
  accepted.steps[0].startedAt = 10;
  let repaired = null;
  const recovery = new MissionEngine({
    load: async () => ({ schema: 1, missions: { running: clone(accepted) }, order: ['running'] }),
    save: async state => { repaired = clone(state); },
    now: () => 20
  });
  await recovery.init();
  assert.strictEqual(recovery.getMission('running').status, 'interrupted', 'valid interrupted runtime state must remain recoverable');
  assert.strictEqual(recovery.getMission('running').steps[0].status, 'pending');
  assert.ok(repaired, 'repaired valid runtime state should be durably persisted');

  console.log('mission durable runtime contract PASS');
})().catch(error => { console.error(error); process.exit(1); });
