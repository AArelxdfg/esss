'use strict';
const assert = require('assert');
const { OutcomeMemory } = require('../src/outcome-memory');

(async () => {
  let persisted = null;
  let failNext = false;
  let holdResolve = null;
  let holdNext = false;
  let clock = 4000;
  const load = async () => persisted;
  const save = async state => {
    if (holdNext) {
      holdNext = false;
      await new Promise(resolve => { holdResolve = resolve; });
    }
    if (failNext) {
      failNext = false;
      throw new Error('simulated persistence failure');
    }
    persisted = JSON.parse(JSON.stringify(state));
  };

  const memory = new OutcomeMemory({ load, save, now: () => ++clock });
  await memory.init();

  await memory.recordOutcome({
    missionId: 'm-good', goal: 'durable verified task', status: 'completed', summary: 'baseline',
    verification: { strict: true, adversarial: true, confidence: 0.91, evidenceIds: ['ev-good'] }
  });
  assert.strictEqual(memory.snapshot().outcomes.length, 1);

  failNext = true;
  await assert.rejects(() => memory.recordOutcome({
    missionId: 'm-ghost', goal: 'must not survive failed save', status: 'failed',
    failurePattern: 'ghost state', verification: { strict: true, adversarial: true, confidence: 0.9, evidenceIds: ['ev-ghost'] }
  }), /simulated persistence failure/);
  assert.deepStrictEqual(memory.snapshot(), persisted, 'failed outcome save must roll RAM back to durable state');
  assert.strictEqual(memory.snapshot().outcomes.some(o => o.missionId === 'm-ghost'), false);

  failNext = true;
  await assert.rejects(() => memory.proposeSkill({
    missionId: 'm-good', name: 'Ghost skill', description: 'must roll back', procedure: ['x'], evidenceIds: ['ev-good'],
    verification: { strict: true, adversarial: true, confidence: 0.91, evidenceIds: ['ev-good'] }
  }), /simulated persistence failure/);
  assert.deepStrictEqual(memory.snapshot(), persisted, 'failed skill save must roll RAM back to durable state');
  assert.strictEqual(memory.snapshot().skillCandidates.length, 0);

  holdNext = true;
  const first = memory.recordOutcome({
    missionId: 'm-held', goal: 'serialize learning writes', status: 'completed',
    verification: { strict: true, adversarial: true, confidence: 0.9, evidenceIds: ['ev-held'] }
  });
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(() => memory.recordOutcome({
    missionId: 'm-race', goal: 'must be rejected during save', status: 'partial', verification: {}
  }), err => err && err.code === 'OUTCOME_MEMORY_PERSISTENCE_IN_PROGRESS');
  assert.strictEqual(memory.snapshot().outcomes.some(o => o.missionId === 'm-race'), false);
  holdResolve();
  await first;

  const restored = new OutcomeMemory({ load, save, now: () => ++clock });
  await restored.init();
  assert.strictEqual(restored.snapshot().outcomes.some(o => o.missionId === 'm-held'), true);
  assert.strictEqual(restored.snapshot().outcomes.some(o => o.missionId === 'm-race'), false);
  assert.strictEqual(restored.snapshot().skillCandidates.length, 0);

  console.log('MONOLITH outcome memory persistence transaction PASS');
})().catch(err => { console.error(err); process.exit(1); });
