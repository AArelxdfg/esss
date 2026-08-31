'use strict';

const assert = require('assert');
const { OutcomeMemory } = require('../src/outcome-memory');
const { digest, receiptStateKey } = require('../src/verified-mission-finalizer');

function receiptFor({ missionId, claim, evidenceIds }) {
  const strictScore = 0.91;
  const adversarialScore = 0.89;
  const toolTraceDigest = digest([]);
  const stateKey = receiptStateKey({
    missionId,
    claim,
    evidenceIds,
    materialBindings: [],
    strictScore,
    adversarialScore,
    toolTraceDigest
  });
  return {
    schema: 2,
    missionId,
    claim,
    evidenceIds,
    materialBindings: [],
    strictScore,
    adversarialScore,
    toolTraceDigest,
    stateKey,
    sha256: stateKey,
    issuedAt: 1
  };
}

(async () => {
  let persisted = null;
  let clock = 5000;
  const memory = new OutcomeMemory({
    load: async () => persisted,
    save: async state => { persisted = JSON.parse(JSON.stringify(state)); },
    now: () => ++clock
  });
  await memory.init();

  const missionId = 'm-repeat';
  const firstReceipt = receiptFor({ missionId, claim: 'first verified result', evidenceIds: ['ev_first'] });
  const first = await memory.recordOutcome({
    missionId,
    goal: 'repeatable mission',
    status: 'completed',
    summary: 'first completion',
    verification: {
      strict: true,
      adversarial: true,
      confidence: 0.89,
      evidenceIds: ['ev_first'],
      receipt: firstReceipt
    }
  });

  const secondReceipt = receiptFor({ missionId, claim: 'second verified result', evidenceIds: ['ev_second'] });
  const second = await memory.recordOutcome({
    missionId,
    goal: 'repeatable mission',
    status: 'completed',
    summary: 'second completion',
    verification: {
      strict: true,
      adversarial: true,
      confidence: 0.89,
      evidenceIds: ['ev_second'],
      receipt: secondReceipt
    }
  });
  assert.notStrictEqual(first.id, second.id);

  await assert.rejects(
    () => memory.proposeSkill({
      missionId,
      name: 'First outcome skill without binding',
      description: 'must not silently bind to the latest outcome',
      procedure: ['use first evidence'],
      evidenceIds: ['ev_first'],
      verification: {
        strict: true,
        adversarial: true,
        confidence: 0.89,
        evidenceIds: ['ev_first'],
        receiptSha256: first.verification.receiptSha256
      }
    }),
    /source verified finalization receipt/
  );

  const candidate = await memory.proposeSkill({
    missionId,
    sourceOutcomeId: first.id,
    name: 'First outcome skill with exact binding',
    description: 'bind recovery to the receipt-specific source outcome',
    procedure: ['use first evidence'],
    evidenceIds: ['ev_first'],
    verification: {
      strict: true,
      adversarial: true,
      confidence: 0.89,
      evidenceIds: ['ev_first'],
      receiptSha256: first.verification.receiptSha256
    }
  });

  assert.strictEqual(candidate.sourceOutcomeId, first.id);
  assert.strictEqual(candidate.sourceReceiptSha256, first.verification.receiptSha256);
  assert.deepStrictEqual(candidate.sourceEvidenceIds, ['ev_first']);

  await assert.rejects(
    () => memory.proposeSkill({
      missionId,
      sourceOutcomeId: 'outcome_missing',
      name: 'Missing exact outcome',
      description: 'must fail closed',
      procedure: ['x'],
      evidenceIds: ['ev_first'],
      verification: {
        strict: true,
        adversarial: true,
        confidence: 0.89,
        evidenceIds: ['ev_first'],
        receiptSha256: first.verification.receiptSha256
      }
    }),
    /verified completed mission outcome/
  );

  console.log('MONOLITH skill exact outcome binding PASS', {
    latestOutcomeFallbackCannotHijackReceipt: true,
    exactSourceOutcomeBinding: true,
    missingSourceOutcomeFailsClosed: true
  });
})().catch(err => { console.error(err); process.exit(1); });
