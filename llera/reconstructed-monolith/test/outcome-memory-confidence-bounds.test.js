'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { OutcomeMemory, normalizeUnitConfidence } = require('../src/outcome-memory');

function makeMemory() {
  let persisted = null;
  const memory = new OutcomeMemory({
    load: async () => persisted,
    save: async value => { persisted = value; },
    now: () => 1_700_000_000_000
  });
  return { memory, readPersisted: () => persisted };
}

test('unit confidence rejects non-number, non-finite and out-of-range values', () => {
  for (const value of ['0.9', true, false, NaN, Infinity, -Infinity, -0.01, 1.01, {}, []]) {
    assert.throws(
      () => normalizeUnitConfidence(value),
      error => error && error.code === 'OUTCOME_VERIFICATION_CONFIDENCE_INVALID'
    );
  }
});

test('unit confidence keeps exact bounded numeric values and defaults absent values to zero', () => {
  assert.equal(normalizeUnitConfidence(undefined), 0);
  assert.equal(normalizeUnitConfidence(null), 0);
  assert.equal(normalizeUnitConfidence(''), 0);
  assert.equal(normalizeUnitConfidence(0), 0);
  assert.equal(normalizeUnitConfidence(0.62), 0.62);
  assert.equal(normalizeUnitConfidence(1), 1);
});

test('failed outcome rejects Infinity before mutating or persisting state', async () => {
  const { memory, readPersisted } = makeMemory();
  await memory.init();

  await assert.rejects(
    () => memory.recordOutcome({
      missionId: 'mission-confidence-corruption',
      goal: 'preserve durable outcome semantics',
      status: 'failed',
      verification: { confidence: Infinity }
    }),
    error => error && error.code === 'OUTCOME_VERIFICATION_CONFIDENCE_INVALID'
  );

  assert.equal(memory.snapshot().outcomes.length, 0);
  assert.equal(readPersisted(), null);
});

test('partial outcome rejects numeric strings instead of coercing them', async () => {
  const { memory } = makeMemory();
  await memory.init();

  await assert.rejects(
    () => memory.recordOutcome({
      missionId: 'mission-confidence-string',
      goal: 'reject ambiguous verifier types',
      status: 'partial',
      verification: { confidence: '0.75' }
    }),
    error => error && error.code === 'OUTCOME_VERIFICATION_CONFIDENCE_INVALID'
  );

  assert.equal(memory.snapshot().outcomes.length, 0);
});

test('bounded numeric confidence persists without JSON semantic drift', async () => {
  const { memory, readPersisted } = makeMemory();
  await memory.init();

  const outcome = await memory.recordOutcome({
    missionId: 'mission-confidence-valid',
    goal: 'persist exact confidence',
    status: 'partial',
    verification: { confidence: 0.41 }
  });

  assert.equal(outcome.verification.confidence, 0.41);
  assert.equal(memory.snapshot().outcomes[0].verification.confidence, 0.41);
  assert.equal(readPersisted().outcomes[0].verification.confidence, 0.41);
});
