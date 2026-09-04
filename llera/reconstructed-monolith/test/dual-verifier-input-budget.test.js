'use strict';

const assert = require('node:assert');
const {
  MAX_VERIFIER_EVIDENCE,
  MAX_VERIFIER_CHECKS,
  MAX_CHECK_EVIDENCE_REFS,
  StrictEvidenceVerifier,
  AdversarialEvidenceVerifier,
  DualVerifier,
  checkSetSignature
} = require('../src/dual-verifier');
const { EvidenceLedger } = require('../src/evidence-ledger');

(() => {
  const ledger = new EvidenceLedger({ missionId:'mission-verifier-budget' });
  const entry = ledger.add({
    stepId:'step-1',
    tool:'read_file',
    kind:'file',
    target:'C:/tmp/verifier-budget.txt',
    bytes:Buffer.from('budget-bound evidence', 'utf8'),
    summary:'bounded verifier evidence',
    observedAt:'2026-09-04T08:12:00.000Z'
  });

  const strict = new StrictEvidenceVerifier();
  const adversarial = new AdversarialEvidenceVerifier();

  assert.equal(strict.verify({evidence:{}, checks:[]}).reason, 'strict_invalid_evidence_list');
  assert.equal(adversarial.verify({evidence:{}, checks:[]}).reason, 'adversarial_invalid_evidence_list');

  const tooManyEvidence = Array.from({length:MAX_VERIFIER_EVIDENCE + 1}, () => entry);
  assert.equal(new DualVerifier().verify({
    claim:'oversized evidence must reject before verifier work',
    evidence:tooManyEvidence,
    strictChecks:[],
    adversarialChecks:[]
  }).reason, 'verifier_evidence_limit_reject');

  const tooManyChecks = Array.from({length:MAX_VERIFIER_CHECKS + 1}, (_, index) => ({
    name:`strict-${index}`,
    independenceKey:`strict-${index}`,
    ok:true,
    evidenceIds:[entry.id]
  }));
  assert.equal(new DualVerifier().verify({
    claim:'oversized check list must reject before signature work',
    evidence:[entry],
    strictChecks:tooManyChecks,
    adversarialChecks:[]
  }).reason, 'verifier_check_limit_reject');

  const refs = Array.from({length:MAX_CHECK_EVIDENCE_REFS + 1}, () => entry.id);
  const refBudget = strict.verify({
    evidence:[entry],
    checks:[{name:'too many refs', ok:true, evidenceIds:refs}]
  });
  assert.equal(refBudget.ok, false);
  assert.equal(refBudget.checks[0].evidenceRefsValid, false);
  assert.equal(refBudget.checks[0].bindingOk, false);

  const circularStrict = {name:'strict circular', independenceKey:'strict-circular', ok:true, evidenceIds:[entry.id]};
  circularStrict.self = circularStrict;
  const circularAdversarial = {name:'adversarial circular', independenceKey:'adversarial-circular', ok:true, severity:'critical', evidenceIds:[entry.id]};
  circularAdversarial.self = circularAdversarial;
  assert.doesNotThrow(() => checkSetSignature([circularStrict]));

  const circularResult = new DualVerifier().verify({
    claim:'circular metadata must not crash verifier independence checks',
    evidence:[entry],
    strictChecks:[circularStrict],
    adversarialChecks:[circularAdversarial]
  });
  assert.equal(circularResult.ok, true);
  assert.equal(circularResult.reason, 'dual_verifier_pass');

  console.log('MONOLITH dual verifier input budget regression PASS');
})();
