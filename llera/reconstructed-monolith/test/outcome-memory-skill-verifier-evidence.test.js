'use strict';

const assert = require('assert');
const { OutcomeMemory } = require('../src/outcome-memory');
const { receiptStateKey } = require('../src/verified-mission-finalizer');

const EV1 = `ev_${'1'.repeat(24)}`;
const EV2 = `ev_${'2'.repeat(24)}`;

function makeReceipt(missionId) {
  const identity = {
    missionId,
    claim: 'verified skill source',
    evidenceIds: [EV1, EV2],
    materialBindings: [],
    strictScore: 0.91,
    adversarialScore: 0.88,
    toolTraceDigest: 'a'.repeat(64)
  };
  const stateKey = receiptStateKey(identity);
  return { schema: 2, ...identity, stateKey, sha256: stateKey, issuedAt: 1 };
}

(async () => {
  let persisted = null;
  let clock = 10;
  const memory = new OutcomeMemory({
    load: async () => persisted,
    save: async state => { persisted = JSON.parse(JSON.stringify(state)); },
    now: () => ++clock
  });
  await memory.init();

  const missionId = 'mission-skill-verifier-evidence';
  const receipt = makeReceipt(missionId);
  await memory.recordOutcome({
    missionId,
    goal: 'restore verified skill evolution',
    status: 'completed',
    verification: {
      strict: true,
      adversarial: true,
      confidence: 0.88,
      evidenceIds: [EV1, EV2],
      receipt
    }
  });

  const base = {
    missionId,
    name: 'Evidence-bound skill',
    description: 'A skill candidate whose verifier must cover its evidence.',
    procedure: ['observe', 'verify'],
    evidenceIds: [EV1, EV2]
  };

  await assert.rejects(
    () => memory.proposeSkill({
      ...base,
      verification: { strict: true, adversarial: true, confidence: 0.88, receiptSha256: receipt.sha256 }
    }),
    error => error && error.code === 'OUTCOME_EVIDENCE_ID_INVALID' && error.reason === 'evidence_ids_required'
  );

  await assert.rejects(
    () => memory.proposeSkill({
      ...base,
      verification: {
        strict: true,
        adversarial: true,
        confidence: 0.88,
        receiptSha256: receipt.sha256,
        evidenceIds: [EV1]
      }
    }),
    /skill candidate evidence was not covered by skill verification/
  );

  const candidate = await memory.proposeSkill({
    ...base,
    verification: {
      strict: true,
      adversarial: true,
      confidence: 0.88,
      receiptSha256: receipt.sha256,
      evidenceIds: [EV1, EV2]
    }
  });
  assert.deepStrictEqual(candidate.evidenceIds, [EV1, EV2]);
  assert.strictEqual(candidate.sourceReceiptSha256, receipt.sha256);
  assert.strictEqual(candidate.executable, false);
  assert.strictEqual(candidate.approvalRequired, true);

  console.log('outcome-memory skill verifier evidence regression PASS', {
    missingVerifierEvidenceRejected: true,
    partialVerifierEvidenceRejected: true,
    completeVerifierCoverageAccepted: true
  });
})().catch(error => {
  console.error(error);
  process.exit(1);
});
