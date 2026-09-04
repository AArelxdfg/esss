'use strict';

const assert = require('node:assert');
const { validateEvidenceBindings } = require('../src/mission-evidence-binding');

(() => {
  const id = 'ev_0123456789abcdef01234567';
  const context = {
    evidenceIds: [id],
    missionId: 'mission-boundary-test',
    stepId: 'step-boundary-test',
    tool: 'read_file'
  };

  assert.throws(
    () => validateEvidenceBindings({ ...context, ledger: { snapshot: () => ({ entries: [] }) } }),
    error => error && error.code === 'MISSION_EVIDENCE_LEDGER_INVALID'
  );

  assert.throws(
    () => validateEvidenceBindings({ ...context, ledger: { snapshot: () => { throw new Error('corrupt snapshot'); } } }),
    error => error && error.code === 'MISSION_EVIDENCE_LEDGER_INVALID'
  );

  assert.throws(
    () => validateEvidenceBindings({ ...context, ledger: { entries: { [id]: {} } } }),
    error => error && error.code === 'MISSION_EVIDENCE_LEDGER_INVALID'
  );

  assert.throws(
    () => validateEvidenceBindings({ ...context, ledger: [{ id }, { id }] }),
    error => error && error.code === 'MISSION_EVIDENCE_DUPLICATE'
  );

  assert.throws(
    () => validateEvidenceBindings({ ...context, ledger: { snapshot: () => [{ id }, { id }] } }),
    error => error && error.code === 'MISSION_EVIDENCE_DUPLICATE'
  );

  for (const invalidContext of [
    { missionId: { value: context.missionId } },
    { stepId: [context.stepId] },
    { tool: { toString: () => context.tool } },
    { missionId: '   ' },
    { stepId: '' }
  ]) {
    assert.throws(
      () => validateEvidenceBindings({ ...context, ...invalidContext, ledger: [] }),
      error => error && error.code === 'MISSION_EVIDENCE_CONTEXT_REQUIRED'
    );
  }

  assert.throws(
    () => validateEvidenceBindings({
      ...context,
      ledger: [{
        id,
        missionId: { value: context.missionId },
        stepId: context.stepId,
        tool: context.tool,
        kind: 'file',
        target: 'C:/tmp/evidence.txt',
        sha256: '0'.repeat(64),
        bindingSha256: '0'.repeat(64),
        byteCount: 1,
        observedAt: '2026-09-04T00:00:00.000Z',
        summary: 'malformed mission identity'
      }]
    }),
    error => error && error.code === 'MISSION_EVIDENCE_MISSION_INVALID'
  );

  console.log('MONOLITH mission evidence malformed-ledger boundary regression PASS');
})();
