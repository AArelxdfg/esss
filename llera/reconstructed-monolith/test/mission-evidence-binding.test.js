'use strict';

const assert = require('node:assert');
const { validateEvidenceBindings } = require('../src/mission-evidence-binding');

(() => {
  const id = 'ev_0123456789abcdef01234567';
  const entry = {
    id,
    missionId: 'mission_alpha',
    stepId: 'step_write',
    tool: 'write_file',
    target: 'proof.txt',
    sha256: 'a'.repeat(64),
    bindingSha256: 'b'.repeat(64)
  };
  const ledger = { snapshot: () => [entry] };

  const bound = validateEvidenceBindings({
    evidenceIds: [id, id],
    ledger,
    missionId: 'mission_alpha',
    stepId: 'step_write',
    tool: 'write_file'
  });

  assert.deepStrictEqual(bound, [{
    id,
    missionId: 'mission_alpha',
    stepId: 'step_write',
    tool: 'write_file',
    target: 'proof.txt',
    sha256: 'a'.repeat(64),
    bindingSha256: 'b'.repeat(64)
  }]);

  assert.throws(
    () => validateEvidenceBindings({ evidenceIds: [id], ledger, missionId: 'mission_beta', stepId: 'step_write', tool: 'write_file' }),
    error => error && error.code === 'MISSION_EVIDENCE_MISSION_MISMATCH'
  );
  assert.throws(
    () => validateEvidenceBindings({ evidenceIds: [id], ledger, missionId: 'mission_alpha', stepId: 'step_read', tool: 'write_file' }),
    error => error && error.code === 'MISSION_EVIDENCE_STEP_MISMATCH'
  );
  assert.throws(
    () => validateEvidenceBindings({ evidenceIds: [id], ledger, missionId: 'mission_alpha', stepId: 'step_write', tool: 'read_file' }),
    error => error && error.code === 'MISSION_EVIDENCE_TOOL_MISMATCH'
  );
  assert.throws(
    () => validateEvidenceBindings({ evidenceIds: ['ev_89abcdef0123456789abcdef'], ledger, missionId: 'mission_alpha', stepId: 'step_write', tool: 'write_file' }),
    error => error && error.code === 'MISSION_EVIDENCE_NOT_FOUND'
  );

  console.log('MONOLITH mission evidence binding regression PASS');
})();
