'use strict';

const assert = require('node:assert');
const { validateEvidenceBindings } = require('../src/mission-evidence-binding');

const missionId = 'mission_integrity';
const stepId = 'step_integrity';
const tool = 'read_file';
const evidenceId = 'ev_0123456789abcdef01234567';

function makeEntry(overrides = {}) {
  return {
    id: evidenceId,
    missionId,
    stepId,
    tool,
    target: 'proof.txt',
    sha256: 'a'.repeat(64),
    bindingSha256: 'b'.repeat(64),
    ...overrides
  };
}

function ledger(entry) {
  return { snapshot: () => [entry] };
}

function validate(entry) {
  return validateEvidenceBindings({
    evidenceIds: [evidenceId],
    ledger: ledger(entry),
    missionId,
    stepId,
    tool
  });
}

const accepted = validate(makeEntry());
assert.strictEqual(accepted.length, 1);
assert.strictEqual(accepted[0].target, 'proof.txt');
assert.strictEqual(accepted[0].sha256, 'a'.repeat(64));
assert.strictEqual(accepted[0].bindingSha256, 'b'.repeat(64));

for (const [overrides, code] of [
  [{ target: '' }, 'MISSION_EVIDENCE_TARGET_INVALID'],
  [{ target: '   ' }, 'MISSION_EVIDENCE_TARGET_INVALID'],
  [{ target: null }, 'MISSION_EVIDENCE_TARGET_INVALID'],
  [{ sha256: null }, 'MISSION_EVIDENCE_SHA256_INVALID'],
  [{ sha256: 'a'.repeat(63) }, 'MISSION_EVIDENCE_SHA256_INVALID'],
  [{ sha256: 'G'.repeat(64) }, 'MISSION_EVIDENCE_SHA256_INVALID'],
  [{ bindingSha256: null }, 'MISSION_EVIDENCE_BINDING_SHA256_INVALID'],
  [{ bindingSha256: 'b'.repeat(65) }, 'MISSION_EVIDENCE_BINDING_SHA256_INVALID'],
  [{ bindingSha256: 'Z'.repeat(64) }, 'MISSION_EVIDENCE_BINDING_SHA256_INVALID']
]) {
  assert.throws(
    () => validate(makeEntry(overrides)),
    error => error && error.code === code,
    `${code} must fail closed`
  );
}

console.log('MONOLITH evidence binding integrity regression PASS');
