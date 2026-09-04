'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveEvidenceLedgerStoragePath } = require('../app/services/evidence-bound-work-mode-service.cjs');

test('evidence ledger storage stays inside the mission evidence root', () => {
  const userData = path.resolve('tmp', 'llera-user-data');
  const resolved = resolveEvidenceLedgerStoragePath(userData, 'mission-safe_123');
  const evidenceRoot = path.resolve(userData, 'evidence');
  assert.equal(path.dirname(resolved), evidenceRoot);
  assert.equal(path.basename(resolved), 'mission-safe_123.json');
});

test('evidence ledger storage rejects traversal and separator-bearing mission ids', () => {
  const userData = path.resolve('tmp', 'llera-user-data');
  const invalidMissionIds = [
    '../escape',
    '..\\escape',
    'nested/mission',
    'nested\\mission',
    '.',
    '..',
    '',
    '   ',
    `mission\0escape`
  ];

  for (const missionId of invalidMissionIds) {
    assert.throws(
      () => resolveEvidenceLedgerStoragePath(userData, missionId),
      error => error?.code === 'WORK_MODE_EVIDENCE_MISSION_ID_INVALID',
      `expected mission id ${JSON.stringify(missionId)} to fail closed`
    );
  }
});

test('evidence ledger storage bounds pathological mission identifiers', () => {
  const userData = path.resolve('tmp', 'llera-user-data');
  assert.throws(
    () => resolveEvidenceLedgerStoragePath(userData, 'm'.repeat(201)),
    error => error?.code === 'WORK_MODE_EVIDENCE_MISSION_ID_INVALID'
  );
});
