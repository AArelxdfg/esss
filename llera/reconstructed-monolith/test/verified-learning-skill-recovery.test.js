'use strict';
const assert = require('assert');
const crypto = require('crypto');
const { VerifiedLearningCoordinator } = require('../src/verified-learning-coordinator');
const { receiptStateKey } = require('../src/verified-mission-finalizer');

(async () => {
  const missionId = 'mission-skill-recovery';
  const claim = 'verified restore completed';
  const evidenceIds = ['ev-recovery-1'];
  const toolTraceDigest = crypto.createHash('sha256').update('durable-trace').digest('hex');
  const materialBindings = [{ traceId: 'trace-1', evidenceIds }];
  const strictScore = 0.91;
  const adversarialScore = 0.83;
  const stateKey = receiptStateKey({
    missionId, claim, evidenceIds, materialBindings, strictScore, adversarialScore, toolTraceDigest
  });
  const receipt = {
    schema: 2,
    missionId,
    claim,
    evidenceIds,
    materialBindings,
    strictScore,
    adversarialScore,
    toolTraceDigest,
    stateKey,
    sha256: stateKey,
    issuedAt: 1
  };

  let durable = null;
  const memoryState = { outcomes: [], skillCandidates: [] };
  let skillAttempts = 0;
  const memory = {
    snapshot: () => JSON.parse(JSON.stringify(memoryState)),
    async recordOutcome(input) {
      const outcome = { id: 'out-recovery-1', ...input, verified: true };
      memoryState.outcomes.push(outcome);
      return JSON.parse(JSON.stringify(outcome));
    },
    async proposeSkill(input) {
      skillAttempts += 1;
      if (skillAttempts === 1) throw new Error('simulated crash after outcome commit');
      const candidate = {
        id: 'skill-recovery-1',
        sourceOutcomeId: 'out-recovery-1',
        trust: 'candidate-only',
        executable: false,
        ...input
      };
      memoryState.skillCandidates.push(candidate);
      return JSON.parse(JSON.stringify(candidate));
    }
  };
  const finalizer = {
    async finalize() {
      return {
        ok: true,
        publishable: true,
        receipt: { ...receipt },
        verification: { evidenceIds: [...evidenceIds] }
      };
    }
  };
  const saveState = async state => { durable = JSON.parse(JSON.stringify(state)); };
  const skill = { name: 'recover-skill', description: 'resume verified skill evolution', procedure: ['observe', 'act', 'verify'] };

  const first = new VerifiedLearningCoordinator({
    finalizer, outcomeMemory: memory, loadState: async () => durable, saveState
  });
  await first.init();
  await assert.rejects(
    () => first.finalizeAndLearn({ missionId, goal: 'restore', claim, skill }),
    /simulated crash/
  );
  assert.strictEqual(memoryState.outcomes.length, 1, 'verified outcome must survive partial commit');
  assert.strictEqual(memoryState.skillCandidates.length, 0, 'skill must not be falsely recorded after failed proposal');
  assert.strictEqual(durable.receipts[stateKey].status, 'applying');

  const restarted = new VerifiedLearningCoordinator({
    finalizer, outcomeMemory: memory, loadState: async () => durable, saveState
  });
  await restarted.init();
  const recovered = await restarted.finalizeAndLearn({ missionId, goal: 'restore', claim, skill });

  assert.strictEqual(recovered.ok, true);
  assert.strictEqual(recovered.idempotent, true, 'existing outcome must be reused after restart');
  assert.strictEqual(recovered.resumedSkillEvolution, true, 'missing skill evolution must resume');
  assert.strictEqual(memoryState.outcomes.length, 1, 'restart must not duplicate the verified outcome');
  assert.strictEqual(memoryState.skillCandidates.length, 1, 'restart must recover exactly one skill candidate');
  assert.strictEqual(durable.receipts[stateKey].status, 'committed');
  assert.strictEqual(durable.receipts[stateKey].skillCandidateId, 'skill-recovery-1');

  const replayed = await restarted.finalizeAndLearn({ missionId, goal: 'restore', claim, skill });
  assert.strictEqual(replayed.idempotent, true);
  assert.strictEqual(memoryState.outcomes.length, 1);
  assert.strictEqual(memoryState.skillCandidates.length, 1, 'replay must not duplicate recovered skill');

  console.log('verified learning skill recovery PASS', {
    partialCommitRecovery: true,
    outcomeIdempotent: true,
    skillEvolutionResumed: true,
    duplicateSkillBlocked: true
  });
})().catch(error => {
  console.error(error);
  process.exit(1);
});
