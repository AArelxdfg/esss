'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { VerifiedLearningCoordinator } = require('../src/verified-learning-coordinator');

const missionId = 'mission-skill-resume-provenance';
const evidenceIds = ['ev_0123456789abcdef01234567'];
const receiptSha256 = 'a'.repeat(64);
const outcome = { id: 'outcome_verified_source' };
const skill = {
  name: 'resume verified workflow',
  description: 'resume only from the verified source',
  procedure: ['observe', 'act', 'verify']
};

function makeCoordinator(candidate) {
  let proposeCalls = 0;
  const outcomeMemory = {
    recordOutcome: async () => outcome,
    snapshot: () => ({ outcomes: [], skillCandidates: candidate ? [candidate] : [] }),
    proposeSkill: async () => {
      proposeCalls += 1;
      return { id: 'new_candidate' };
    }
  };
  const coordinator = new VerifiedLearningCoordinator({
    finalizer: { finalize: async () => ({ ok: false }) },
    outcomeMemory,
    loadState: async () => null,
    saveState: async () => {}
  });
  return { coordinator, proposeCalls: () => proposeCalls };
}

function duplicate(overrides = {}) {
  return {
    id: 'skill_candidate_existing',
    missionId,
    name: skill.name,
    sourceOutcomeId: outcome.id,
    evidenceIds,
    sourceEvidenceIds: evidenceIds,
    sourceReceiptSha256: receiptSha256,
    trust: 'candidate-only',
    executable: false,
    approvalRequired: true,
    ...overrides
  };
}

function ensure(coordinator) {
  return coordinator._ensureSkillCandidate({
    missionId,
    goal: 'resume verified learning safely',
    claim: 'verified completion',
    summary: '',
    evidenceIds,
    receipt: { sha256: receiptSha256 },
    verifiedContext: { strict: true, adversarial: true, confidence: 0.9, evidenceIds, receiptSha256 },
    outcome,
    skill
  });
}

test('resumed skill candidate rejects receipt/evidence/trust provenance collisions', async () => {
  for (const forged of [
    duplicate({ sourceReceiptSha256: 'b'.repeat(64) }),
    duplicate({ evidenceIds: ['ev_aaaaaaaaaaaaaaaaaaaaaaaa'] }),
    duplicate({ sourceEvidenceIds: ['ev_bbbbbbbbbbbbbbbbbbbbbbbb'] }),
    duplicate({ trust: 'trusted' }),
    duplicate({ executable: true }),
    duplicate({ approvalRequired: false })
  ]) {
    const { coordinator, proposeCalls } = makeCoordinator(forged);
    await assert.rejects(
      () => ensure(coordinator),
      error => error && error.code === 'VERIFIED_LEARNING_SKILL_COLLISION'
    );
    assert.equal(proposeCalls(), 0);
  }
});

test('resumed skill candidate reuses only an exactly provenance-bound candidate', async () => {
  const existing = duplicate();
  const { coordinator, proposeCalls } = makeCoordinator(existing);
  const result = await ensure(coordinator);
  assert.equal(result, existing);
  assert.equal(proposeCalls(), 0);
});
