'use strict';

const assert = require('node:assert');
const { validateEvidenceBindings } = require('../src/mission-evidence-binding');
const { evidenceId, evidenceBindingSeal } = require('../src/evidence-ledger');

const missionId = 'mission_integrity';
const stepId = 'step_integrity';
const tool = 'read_file';

function makeEntry(overrides = {}) {
  const base = {
    missionId,
    stepId,
    tool,
    kind: 'filesystem.read',
    target: 'proof.txt',
    sha256: 'a'.repeat(64),
    byteCount: 12,
    observedAt: '2026-09-02T12:00:00.000Z',
    summary: 'independently re-read proof.txt'
  };
  const fields = { ...base, ...overrides };
  const id = evidenceId(fields);
  return {
    ...fields,
    id,
    bindingSha256: evidenceBindingSeal(fields)
  };
}

function ledger(entry) {
  return { snapshot: () => [entry] };
}

function validate(entry, requestedId = entry.id) {
  return validateEvidenceBindings({
    evidenceIds: [requestedId],
    ledger: ledger(entry),
    missionId,
    stepId,
    tool
  });
}

const acceptedEntry = makeEntry();
const accepted = validate(acceptedEntry);
assert.strictEqual(accepted.length, 1);
assert.strictEqual(accepted[0].target, 'proof.txt');
assert.strictEqual(accepted[0].sha256, 'a'.repeat(64));
assert.strictEqual(accepted[0].bindingSha256, acceptedEntry.bindingSha256);
assert.strictEqual(accepted[0].kind, 'filesystem.read');
assert.strictEqual(accepted[0].byteCount, 12);

for (const [overrides, code] of [
  [{ target: '' }, 'MISSION_EVIDENCE_TARGET_INVALID'],
  [{ target: '   ' }, 'MISSION_EVIDENCE_TARGET_INVALID'],
  [{ target: null }, 'MISSION_EVIDENCE_TARGET_INVALID'],
  [{ sha256: null }, 'MISSION_EVIDENCE_SHA256_INVALID'],
  [{ sha256: 'a'.repeat(63) }, 'MISSION_EVIDENCE_SHA256_INVALID'],
  [{ sha256: 'G'.repeat(64) }, 'MISSION_EVIDENCE_SHA256_INVALID'],
  [{ kind: '' }, 'MISSION_EVIDENCE_KIND_INVALID'],
  [{ byteCount: -1 }, 'MISSION_EVIDENCE_BYTE_COUNT_INVALID'],
  [{ byteCount: 1.5 }, 'MISSION_EVIDENCE_BYTE_COUNT_INVALID'],
  [{ observedAt: 'not-a-date' }, 'MISSION_EVIDENCE_TIMESTAMP_INVALID'],
  [{ summary: '' }, 'MISSION_EVIDENCE_SUMMARY_INVALID']
]) {
  const entry = makeEntry(overrides);
  assert.throws(
    () => validate(entry),
    error => error && error.code === code,
    `${code} must fail closed`
  );
}

{
  const entry = makeEntry();
  entry.sha256 = 'b'.repeat(64);
  assert.throws(
    () => validate(entry),
    error => error && error.code === 'MISSION_EVIDENCE_ID_BINDING_MISMATCH',
    'changing a bound result digest without regenerating identity must fail closed'
  );
}

{
  const entry = makeEntry();
  entry.bindingSha256 = 'b'.repeat(64);
  assert.throws(
    () => validate(entry),
    error => error && error.code === 'MISSION_EVIDENCE_BINDING_SEAL_MISMATCH',
    'forged canonical binding seal must fail closed'
  );
}

{
  const entry = makeEntry();
  entry.summary = 'tampered observation summary';
  assert.throws(
    () => validate(entry),
    error => error && error.code === 'MISSION_EVIDENCE_ID_BINDING_MISMATCH',
    'changing any identity-bound evidence field must invalidate the evidence id'
  );
}

console.log('MONOLITH evidence binding canonical integrity regression PASS');
