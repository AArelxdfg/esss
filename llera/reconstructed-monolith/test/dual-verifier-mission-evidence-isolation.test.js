'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evidenceId, evidenceBindingSeal } = require('../src/evidence-ledger');
const { DualVerifier } = require('../src/dual-verifier');

function makeEvidence({ missionId = 'mission-a', stepId = 'step-1', target = 'C:/LLera/result.txt', sha = 'a' } = {}) {
  const record = {
    missionId,
    stepId,
    tool: 'read_file',
    kind: 'observation',
    target,
    sha256: sha.repeat(64),
    byteCount: 13,
    observedAt: '2026-09-04T07:15:00.000Z',
    summary: 'Independent observation bound to the target bytes.'
  };
  return {
    ...record,
    id: evidenceId(record),
    bindingSha256: evidenceBindingSeal(record),
    metadata: {}
  };
}

function independentChecks(ids) {
  return {
    strictChecks: [{
      name: 'strict-target-byte-binding',
      independenceKey: 'strict-target-byte-binding',
      ok: true,
      evidenceIds: ids
    }],
    adversarialChecks: [{
      name: 'adversarial-replay-probe',
      independenceKey: 'adversarial-replay-probe',
      ok: true,
      severity: 'critical',
      evidenceIds: ids
    }]
  };
}

test('dual verifier rejects duplicate evidence IDs before either verifier can certify coverage', () => {
  const evidence = makeEvidence({missionId:'mission-duplicate'});
  const checks = independentChecks([evidence.id]);
  const result = new DualVerifier().verify({
    claim: 'target bytes were independently observed',
    evidence: [evidence, {...evidence}],
    ...checks
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'duplicate_evidence_id');
  assert.equal(result.strict, undefined);
  assert.equal(result.adversarial, undefined);
});

test('dual verifier rejects cryptographically valid evidence from different missions', () => {
  const first = makeEvidence({missionId:'mission-a', stepId:'step-a', target:'C:/LLera/a.txt', sha:'a'});
  const second = makeEvidence({missionId:'mission-b', stepId:'step-b', target:'C:/LLera/b.txt', sha:'b'});
  const checks = independentChecks([first.id, second.id]);
  const result = new DualVerifier().verify({
    claim: 'one mission completed with verified evidence',
    evidence: [first, second],
    ...checks
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'mixed_mission_evidence_reject');
  assert.deepEqual(new Set(result.missionIds), new Set(['mission-a', 'mission-b']));
});

test('same-mission independently bound evidence remains eligible for dual verification', () => {
  const first = makeEvidence({missionId:'mission-safe', stepId:'step-a', target:'C:/LLera/a.txt', sha:'c'});
  const second = makeEvidence({missionId:'mission-safe', stepId:'step-b', target:'C:/LLera/b.txt', sha:'d'});
  const ids = [first.id, second.id];
  const checks = independentChecks(ids);
  const result = new DualVerifier().verify({
    claim: 'one mission completed with two independently bound observations',
    evidence: [first, second],
    ...checks
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, 'dual_verifier_pass');
  assert.equal(result.missionId, 'mission-safe');
  assert.equal(result.strict.ok, true);
  assert.equal(result.adversarial.ok, true);
  assert.equal(result.evidenceCoverage, 1);
});
