'use strict';

const assert = require('node:assert');
const { validateEvidenceBindings } = require('../src/mission-evidence-binding');
const { evidenceId, evidenceBindingSeal } = require('../src/evidence-ledger');

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

  const bindingContext = {
    missionId: 'mission-snapshot-test',
    stepId: 'step-snapshot-test',
    tool: 'read_file'
  };
  const makeEntry = ({ target, sha256, observedAt, summary }) => {
    const fields = {
      ...bindingContext,
      kind: 'file',
      target,
      sha256,
      byteCount: 1,
      observedAt,
      summary
    };
    return {
      id: evidenceId(fields),
      ...fields,
      bindingSha256: evidenceBindingSeal(fields)
    };
  };
  const first = makeEntry({
    target: 'C:/tmp/first.txt',
    sha256: '1'.repeat(64),
    observedAt: '2026-09-04T06:20:00.000Z',
    summary: 'first stable observation'
  });
  const second = makeEntry({
    target: 'C:/tmp/second.txt',
    sha256: '2'.repeat(64),
    observedAt: '2026-09-04T06:20:01.000Z',
    summary: 'second stable observation'
  });
  let snapshotCalls = 0;
  const mutatingLedger = {
    snapshot() {
      snapshotCalls += 1;
      if (snapshotCalls === 1) return [first, second];
      return [first];
    }
  };
  const bound = validateEvidenceBindings({
    ...bindingContext,
    evidenceIds: [first.id, second.id],
    ledger: mutatingLedger
  });
  assert.equal(snapshotCalls, 1, 'one verifier decision must use one ledger snapshot');
  assert.deepEqual(bound.map(entry => entry.id), [first.id, second.id]);

  console.log('MONOLITH mission evidence malformed-ledger boundary regression PASS');
})();
