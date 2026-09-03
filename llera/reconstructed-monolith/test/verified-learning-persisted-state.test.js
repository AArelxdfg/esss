'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { VerifiedLearningCoordinator } = require('../src/verified-learning-coordinator');

const sha = 'a'.repeat(64);

function makeCoordinator(persisted) {
  return new VerifiedLearningCoordinator({
    finalizer: { finalize: async () => ({ ok: false }) },
    outcomeMemory: {
      recordOutcome: async () => ({}),
      snapshot: () => ({ outcomes: [], skillCandidates: [] })
    },
    loadState: async () => persisted,
    saveState: async () => {}
  });
}

async function expectCorrupt(persisted, reason) {
  const coordinator = makeCoordinator(persisted);
  await assert.rejects(
    () => coordinator.init(),
    error => error && error.code === 'VERIFIED_LEARNING_STATE_CORRUPT' && error.reason === reason
  );
}

test('verified learning init rejects malformed durable receipt state fail-closed', async () => {
  await expectCorrupt({ schema: 1, receipts: [] }, 'invalid_root');
  await expectCorrupt({ schema: 1, receipts: { nope: { status: 'applying', missionId: 'm1' } } }, 'invalid_receipt_key');
  await expectCorrupt({ schema: 1, receipts: { [sha]: [] } }, 'invalid_receipt_record');
  await expectCorrupt({ schema: 1, receipts: { [sha]: { status: 'done', missionId: 'm1' } } }, 'invalid_receipt_status');
  await expectCorrupt({ schema: 1, receipts: { [sha]: { status: 'applying', missionId: '   ' } } }, 'invalid_receipt_mission');
  await expectCorrupt({ schema: 1, receipts: { [sha]: { status: 'committed', missionId: 'm1', outcomeId: 42, skillCandidateId: null } } }, 'invalid_outcome_id');
  await expectCorrupt({ schema: 1, receipts: { [sha]: { status: 'committed', missionId: 'm1', outcomeId: 'o1', skillCandidateId: {} } } }, 'invalid_skill_candidate_id');
});

test('verified learning init rejects ambiguous status-specific durable receipt shapes', async () => {
  await expectCorrupt(
    { schema: 1, receipts: { [sha]: { status: 'applying', missionId: 'm1', outcomeId: 'unexpected' } } },
    'invalid_applying_shape'
  );
  await expectCorrupt(
    { schema: 1, receipts: { [sha]: { status: 'applying', missionId: 'm1', unknown: true } } },
    'invalid_applying_shape'
  );
  await expectCorrupt(
    { schema: 1, receipts: { [sha]: { status: 'committed', missionId: 'm1', skillCandidateId: null } } },
    'invalid_committed_shape'
  );
  await expectCorrupt(
    { schema: 1, receipts: { [sha]: { status: 'committed', missionId: 'm1', outcomeId: 'o1' } } },
    'invalid_committed_shape'
  );
  await expectCorrupt(
    { schema: 1, receipts: { [sha]: { status: 'committed', missionId: 'm1', outcomeId: 'o1', skillCandidateId: null, extra: 'forged' } } },
    'invalid_committed_shape'
  );
});

test('verified learning init preserves bounded applying and committed restart state', async () => {
  const applying = { schema: 1, receipts: { [sha]: { status: 'applying', missionId: 'mission-applying' } } };
  const applyingCoordinator = makeCoordinator(applying);
  assert.deepEqual(await applyingCoordinator.init(), applying);

  const committed = {
    schema: 1,
    receipts: {
      [sha]: {
        status: 'committed',
        missionId: 'mission-committed',
        outcomeId: 'outcome-1',
        skillCandidateId: null
      }
    }
  };
  const committedCoordinator = makeCoordinator(committed);
  assert.deepEqual(await committedCoordinator.init(), committed);
});
