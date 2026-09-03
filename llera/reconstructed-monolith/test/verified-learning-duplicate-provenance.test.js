'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findOutcomeByReceipt,
  findSkillCandidateBySource
} = require('../src/verified-learning-coordinator');

test('verified learning accepts one unique receipt-bound outcome', () => {
  const tag = `final-receipt:${'a'.repeat(64)}`;
  const outcome = { id: 'outcome_1', missionId: 'mission-1', tags: [tag] };
  assert.equal(findOutcomeByReceipt({ outcomes: [outcome] }, tag), outcome);
});

test('verified learning fails closed when persisted outcomes duplicate a receipt provenance tag', () => {
  const tag = `final-receipt:${'b'.repeat(64)}`;
  assert.throws(
    () => findOutcomeByReceipt({
      outcomes: [
        { id: 'outcome_1', missionId: 'mission-1', tags: [tag] },
        { id: 'outcome_2', missionId: 'mission-1', tags: [tag] }
      ]
    }, tag),
    error => error &&
      error.code === 'VERIFIED_LEARNING_RECEIPT_DUPLICATE' &&
      error.reason === 'duplicate_receipt_outcome'
  );
});

test('verified learning accepts one unique skill candidate for its verified source', () => {
  const candidate = {
    id: 'skill_candidate_1',
    missionId: 'mission-1',
    name: 'Restore runtime',
    sourceOutcomeId: 'outcome_1'
  };
  assert.equal(findSkillCandidateBySource({ skillCandidates: [candidate] }, {
    missionId: 'mission-1',
    name: 'Restore runtime',
    sourceOutcomeId: 'outcome_1'
  }), candidate);
});

test('verified learning fails closed when persisted skills duplicate verified provenance', () => {
  const source = {
    missionId: 'mission-1',
    name: 'Restore runtime',
    sourceOutcomeId: 'outcome_1'
  };
  assert.throws(
    () => findSkillCandidateBySource({
      skillCandidates: [
        { id: 'skill_candidate_1', ...source },
        { id: 'skill_candidate_2', ...source }
      ]
    }, source),
    error => error &&
      error.code === 'VERIFIED_LEARNING_SKILL_DUPLICATE' &&
      error.reason === 'duplicate_skill_candidate'
  );
});
