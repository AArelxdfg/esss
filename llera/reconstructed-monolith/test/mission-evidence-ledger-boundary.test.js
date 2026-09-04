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

  console.log('MONOLITH mission evidence malformed-ledger boundary regression PASS');
})();
