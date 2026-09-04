'use strict';

const assert = require('assert');
const { OutcomeMemory } = require('../src/outcome-memory');
const { receiptStateKey } = require('../src/verified-mission-finalizer');

const EV1 = `ev_${'1'.repeat(24)}`;
const EV2 = `ev_${'2'.repeat(24)}`;

function makeReceipt({ missionId, claim, evidenceIds, trace }) {
  const identity = {
    missionId,
    claim,
    evidenceIds: [...evidenceIds],
    materialBindings: [],
    strictScore: 0.91,
    adversarialScore: 0.87,
    toolTraceDigest: trace.repeat(64)
  };
  const stateKey = receiptStateKey(identity);
  return { schema: 2, ...identity, stateKey, sha256: stateKey, issuedAt: 1 };
}

(async () => {
  let persisted = null;
  let clock = 100;
  const memory = new OutcomeMemory({
    load: async () => persisted,
    save: async state => { persisted = JSON.parse(JSON.stringify(state)); },
    now: () => ++clock
  });
  await memory.init();

  const missionId = 'mission-receipt-source-selection';
  const firstReceipt = makeReceipt({ missionId, claim: 'first verified result', evidenceIds: [EV1], trace: 'a' });
  const secondReceipt = makeReceipt({ missionId, claim: 'second verified result', evidenceIds: [EV2], trace: 'b' });

  const first = await memory.recordOutcome({
    missionId,
    goal: 'restore durable behavior',
    status: 'completed',
    summary: 'first independently verified result',
    verification: {
      strict: true,
      adversarial: true,
      confidence: 0.87,
      evidenceIds: [EV1],
      receipt: firstReceipt
    }
  });

  const second = await memory.recordOutcome({
    missionId,
    goal: 'restore durable behavior',
    status: 'completed',
    summary: 'later independently verified result',
    verification: {
      strict: true,
      adversarial: true,
      confidence: 0.87,
      evidenceIds: [EV2],
      receipt: secondReceipt
    }
  });
  assert.notStrictEqual(first.id, second.id);

  const candidate = await memory.proposeSkill({
    missionId,
    name: 'Receipt-bound recovery skill',
    description: 'Recover skill evolution from the exact verified outcome receipt.',
    procedure: ['load receipt', 'bind outcome', 'verify evidence'],
    evidenceIds: [EV1],
    verification: {
      strict: true,
      adversarial: true,
      confidence: 0.87,
      evidenceIds: [EV1],
      receiptSha256: firstReceipt.sha256
    }
  });

  assert.strictEqual(candidate.sourceOutcomeId, first.id, 'skill must bind to the receipt-matching outcome, not the latest mission outcome');
  assert.strictEqual(candidate.sourceReceiptSha256, firstReceipt.sha256);
  assert.deepStrictEqual(candidate.sourceEvidenceIds, [EV1]);

  await assert.rejects(
    () => memory.proposeSkill({
      missionId,
      name: 'Unknown receipt skill',
      description: 'must reject unknown receipt',
      procedure: ['reject'],
      evidenceIds: [EV1],
      verification: {
        strict: true,
        adversarial: true,
        confidence: 0.9,
        evidenceIds: [EV1],
        receiptSha256: 'f'.repeat(64)
      }
    }),
    /verified completed mission outcome bound to the requested receipt/
  );

  console.log('outcome-memory receipt source selection PASS', {
    sameMissionMultipleOutcomes: true,
    exactReceiptSourceBound: true,
    staleLatestOutcomeIgnored: true,
    unknownReceiptRejected: true
  });
})().catch(error => {
  console.error(error);
  process.exit(1);
});
