'use strict';

const assert = require('node:assert');
const {
  MAX_EVIDENCE_IDS,
  normalizeEvidenceIds
} = require('../src/mission-evidence-binding');

(() => {
  const id = 'ev_0123456789abcdef01234567';

  assert.strictEqual(MAX_EVIDENCE_IDS, 32);
  assert.deepStrictEqual(normalizeEvidenceIds([id, id, id]), [id]);
  assert.deepStrictEqual(normalizeEvidenceIds(Array(MAX_EVIDENCE_IDS).fill(id)), [id]);

  assert.throws(
    () => normalizeEvidenceIds(Array(MAX_EVIDENCE_IDS + 1).fill(id)),
    error => error && error.code === 'MISSION_EVIDENCE_IDS_LIMIT'
  );

  assert.throws(
    () => normalizeEvidenceIds([...Array(MAX_EVIDENCE_IDS).fill(id), { toString: () => id }]),
    error => error && error.code === 'MISSION_EVIDENCE_IDS_LIMIT'
  );

  console.log('MONOLITH mission evidence raw-list budget regression PASS');
})();
