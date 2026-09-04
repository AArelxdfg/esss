'use strict';

const assert = require('node:assert');
const { evidenceId, evidenceBindingSeal } = require('../src/evidence-ledger');
const { validateEvidenceBindings } = require('../src/mission-evidence-binding');

(() => {
  const base = {
    missionId: 'mission_timestamp',
    stepId: 'step_verify',
    tool: 'read_file',
    kind: 'file-observation',
    target: 'proof.txt',
    sha256: 'a'.repeat(64),
    byteCount: 13,
    summary: 'independent file observation'
  };

  const canonicalObservedAt = '2026-09-04T20:46:19.000Z';
  const canonicalIdentity = { ...base, observedAt: canonicalObservedAt };
  const canonicalEntry = {
    ...canonicalIdentity,
    id: evidenceId(canonicalIdentity),
    bindingSha256: evidenceBindingSeal(canonicalIdentity)
  };

  const bound = validateEvidenceBindings({
    evidenceIds: [canonicalEntry.id],
    ledger: [canonicalEntry],
    missionId: base.missionId,
    stepId: base.stepId,
    tool: base.tool
  });
  assert.strictEqual(bound.length, 1);
  assert.strictEqual(bound[0].observedAt, canonicalObservedAt);

  // JavaScript Date.parse accepts this legacy/ambiguous spelling, so build a fully
  // self-consistent forged record to prove the timestamp boundary itself fails
  // closed rather than relying on an ID or binding-seal mismatch.
  const ambiguousIdentity = { ...base, observedAt: '0' };
  const ambiguousEntry = {
    ...ambiguousIdentity,
    id: evidenceId(ambiguousIdentity),
    bindingSha256: evidenceBindingSeal(ambiguousIdentity)
  };
  assert(Number.isFinite(Date.parse(ambiguousEntry.observedAt)));
  assert.throws(
    () => validateEvidenceBindings({
      evidenceIds: [ambiguousEntry.id],
      ledger: [ambiguousEntry],
      missionId: base.missionId,
      stepId: base.stepId,
      tool: base.tool
    }),
    error => error && error.code === 'MISSION_EVIDENCE_TIMESTAMP_INVALID'
  );

  console.log('MONOLITH evidence timestamp canonicalization regression PASS');
})();
