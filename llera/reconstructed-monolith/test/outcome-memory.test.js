'use strict';
const assert = require('assert');
const { OutcomeMemory } = require('../src/outcome-memory');

(async () => {
  let persisted = null;
  let clock = 1000;
  const load = async () => persisted;
  const save = async state => { persisted = JSON.parse(JSON.stringify(state)); };
  const memory = new OutcomeMemory({ load, save, now: () => ++clock });
  await memory.init();

  await memory.recordOutcome({ missionId: 'm-fail', goal: 'download model safely', status: 'failed', summary: 'range downloader corrupted partial file after stale resume metadata', failurePattern: 'stale resume metadata can corrupt ranged model download', tags: ['download','resume','sha256'], verification: { strict: true, adversarial: true, confidence: 0.9, evidenceIds: ['ev1'] } });
  await memory.recordOutcome({ missionId: 'm-good', goal: 'download model safely', status: 'completed', summary: 'validated resume metadata and sha256 before activation', tags: ['download','resume','sha256'], verification: { strict: true, adversarial: true, confidence: 0.88, evidenceIds: ['ev2'] } });

  const hits = memory.search('resume model download sha256');
  assert(hits.length >= 2);
  assert(hits[0].similarity > 0);
  const patterns = memory.recallFailurePatterns('resume download corruption');
  assert.strictEqual(patterns.length, 1);
  assert(patterns[0].pattern.includes('stale resume metadata'));

  const budget = memory.adaptiveBudget('download model safely', { maxAttemptsPerStep: 3, verificationReserve: 1 });
  assert.strictEqual(budget.priorRelated, 2);
  assert(budget.maxAttemptsPerStep >= 3);

  const candidate = await memory.proposeSkill({ missionId: 'm-good', name: 'Verified resumable download', description: 'Resume only after metadata validation and verify SHA-256 before activation.', procedure: ['validate metadata', 'resume ranges', 'verify sha256', 'activate'], evidenceIds: ['ev2'], verification: { strict: true, adversarial: true, confidence: 0.88 } });
  assert.strictEqual(candidate.trust, 'candidate-only');
  assert.strictEqual(candidate.executable, false);
  assert.strictEqual(candidate.approvalRequired, true);

  await assert.rejects(() => memory.proposeSkill({ missionId: 'm-fail', name: 'Bad skill', description: 'must not promote failure', procedure: ['x'], evidenceIds: ['ev1'], verification: { strict: true, adversarial: true, confidence: 0.9 } }), /verified completed mission outcome/);

  const restored = new OutcomeMemory({ load, save, now: () => ++clock });
  await restored.init();
  assert.strictEqual(restored.snapshot().outcomes.length, 2);
  assert.strictEqual(restored.snapshot().skillCandidates.length, 1);
  console.log('outcome-memory parity PASS', { outcomes: 2, skills: 1, failures: patterns.length });
})().catch(err => { console.error(err); process.exit(1); });
