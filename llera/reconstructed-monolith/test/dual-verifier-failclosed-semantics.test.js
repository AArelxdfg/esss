'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evidenceId,
  evidenceBindingSeal
} = require('../src/evidence-ledger');
const {
  validateEnrichedEvidence,
  StrictEvidenceVerifier,
  AdversarialEvidenceVerifier,
  DualVerifier
} = require('../src/dual-verifier');

function makeEvidence(overrides = {}) {
  const base = {
    missionId: 'mission-verifier-failclosed',
    stepId: 'step-1',
    tool: 'write_file',
    kind: 'material_action',
    target: 'C:/LLera/state.json',
    sha256: 'a'.repeat(64),
    byteCount: 42,
    observedAt: '2026-09-03T13:00:00.000Z',
    summary: 'Material write re-observed and bound to target bytes.'
  };
  const bound = {...base, ...overrides};
  return {
    ...bound,
    id: evidenceId(bound),
    bindingSha256: evidenceBindingSeal(bound),
    metadata: {}
  };
}

test('enriched evidence rejects a cryptographically self-consistent invalid timestamp', () => {
  const evidence = makeEvidence({observedAt: 'not-a-real-timestamp'});
  const verdict = validateEnrichedEvidence(evidence);
  assert.deepEqual(verdict, {ok:false, reason:'invalid_evidence_timestamp'});

  const dual = new DualVerifier({requireIndependentChecks:false});
  const result = dual.verify({
    claim: 'material action completed',
    evidence: [evidence],
    strictChecks: [{name:'strict', ok:true, evidenceIds:[evidence.id]}],
    adversarialChecks: [{name:'adversarial', ok:true, severity:'normal', evidenceIds:[evidence.id]}]
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid_evidence_timestamp');
});

test('strict verifier never treats truthy non-boolean ok values as a pass', () => {
  const evidence = makeEvidence();
  const verifier = new StrictEvidenceVerifier({threshold:1, minEvidenceCoverage:1});
  for (const value of ['false', 'true', 1, {}, []]) {
    const result = verifier.verify({
      evidence:[evidence],
      checks:[{name:'strict-claim', ok:value, evidenceIds:[evidence.id]}]
    });
    assert.equal(result.ok, false, `non-boolean ok=${JSON.stringify(value)} must fail closed`);
    assert.equal(result.checks[0].declaredOk, false);
  }

  const pass = verifier.verify({
    evidence:[evidence],
    checks:[{name:'strict-claim', ok:true, evidenceIds:[evidence.id]}]
  });
  assert.equal(pass.ok, true);
});

test('adversarial verifier never treats truthy non-boolean ok values as a pass', () => {
  const evidence = makeEvidence();
  const verifier = new AdversarialEvidenceVerifier({threshold:1, minEvidenceCoverage:1});
  for (const value of ['false', 'true', 1, {}, []]) {
    const result = verifier.verify({
      evidence:[evidence],
      checks:[{name:'counterexample-probe', ok:value, severity:'critical', evidenceIds:[evidence.id]}]
    });
    assert.equal(result.ok, false, `non-boolean ok=${JSON.stringify(value)} must fail closed`);
    assert.equal(result.checks[0].declaredOk, false);
    assert.equal(result.criticalFailure, true);
  }

  const pass = verifier.verify({
    evidence:[evidence],
    checks:[{name:'counterexample-probe', ok:true, severity:'critical', evidenceIds:[evidence.id]}]
  });
  assert.equal(pass.ok, true);
});
