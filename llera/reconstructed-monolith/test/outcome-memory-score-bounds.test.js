'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateFinalizationReceipt } = require('../src/outcome-memory');
const { receiptStateKey } = require('../src/verified-mission-finalizer');

function makeReceipt({ strictScore = 1, adversarialScore = 1 } = {}) {
  const missionId = 'mission-outcome-score-bounds';
  const evidenceIds = ['ev_0123456789abcdef01234567'];
  const identity = {
    missionId,
    claim: 'verified completion',
    evidenceIds,
    materialBindings: [],
    strictScore,
    adversarialScore,
    toolTraceDigest: 'a'.repeat(64)
  };
  const stateKey = receiptStateKey(identity);
  return {
    missionId,
    evidenceIds,
    receipt: {
      schema: 2,
      ...identity,
      stateKey,
      sha256: stateKey
    }
  };
}

test('outcome memory rejects self-consistent verification scores above one', () => {
  for (const scores of [
    { strictScore: 1.000001, adversarialScore: 1 },
    { strictScore: 1, adversarialScore: 1.000001 },
    { strictScore: 42, adversarialScore: 42 }
  ]) {
    const { missionId, evidenceIds, receipt } = makeReceipt(scores);
    assert.deepEqual(
      validateFinalizationReceipt(receipt, { missionId, evidenceIds }),
      { ok: false, reason: 'finalization_receipt_score_reject' }
    );
  }
});

test('outcome memory still accepts a self-consistent normalized receipt', () => {
  const { missionId, evidenceIds, receipt } = makeReceipt({ strictScore: 0.91, adversarialScore: 0.84 });
  const result = validateFinalizationReceipt(receipt, { missionId, evidenceIds });
  assert.equal(result.ok, true);
  assert.equal(result.strictScore, 0.91);
  assert.equal(result.adversarialScore, 0.84);
  assert.equal(result.confidence, 0.84);
});
