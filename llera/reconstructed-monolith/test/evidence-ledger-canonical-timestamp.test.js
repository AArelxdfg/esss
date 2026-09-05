'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EvidenceLedger,
  evidenceId,
  evidenceBindingSeal,
  ledgerSeal
} = require('../src/evidence-ledger');

test('EvidenceLedger accepts only canonical UTC observation timestamps', () => {
  const ledger = new EvidenceLedger({missionId: 'mission-canonical-time'});
  const common = {
    stepId: 'step-1',
    tool: 'read_file',
    kind: 'observation',
    target: 'C:\\tmp\\monolith.txt',
    bytes: Buffer.from('MONOLITH TEST', 'utf8'),
    summary: 'Observed test file bytes.'
  };

  assert.throws(
    () => ledger.add({...common, observedAt: '2026-09-05T01:02:03Z'}),
    /canonical evidence timestamp required/
  );
  assert.throws(
    () => ledger.add({...common, observedAt: '09/05/2026 01:02:03'}),
    /canonical evidence timestamp required/
  );

  const accepted = ledger.add({...common, observedAt: '2026-09-05T01:02:03.000Z'});
  assert.equal(accepted.observedAt, '2026-09-05T01:02:03.000Z');
});

test('sealed restore rejects a recomputed but noncanonical observation timestamp', () => {
  const missionId = 'mission-restore-time';
  const ledger = new EvidenceLedger({missionId});
  const entry = ledger.add({
    stepId: 'step-restore',
    tool: 'read_file',
    kind: 'observation',
    target: 'C:\\tmp\\restore.txt',
    bytes: Buffer.from('RESTORE', 'utf8'),
    summary: 'Restore observation.',
    observedAt: '2026-09-05T01:02:03.000Z'
  });

  const state = ledger.export({sealed: true});
  const restored = {...entry, observedAt: '2026-09-05T01:02:03Z'};
  restored.id = evidenceId(restored);
  restored.bindingSha256 = evidenceBindingSeal(restored);
  state.entries = [restored];
  state.stateSha256 = ledgerSeal(state);

  const target = new EvidenceLedger({missionId});
  assert.throws(
    () => target.import(state),
    error => error && error.code === 'EVIDENCE_LEDGER_ENTRY_INVALID'
  );
  assert.deepEqual(target.snapshot(), []);
});
