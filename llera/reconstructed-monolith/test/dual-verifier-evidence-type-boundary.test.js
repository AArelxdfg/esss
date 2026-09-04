'use strict';

const assert = require('node:assert');
const {
  validateEnrichedEvidence,
  StrictEvidenceVerifier,
  AdversarialEvidenceVerifier,
  DualVerifier
} = require('../src/dual-verifier');
const { EvidenceLedger } = require('../src/evidence-ledger');

(() => {
  const ledger = new EvidenceLedger({ missionId:'mission-verifier-type-boundary' });
  const entry = ledger.add({
    stepId:'step-1',
    tool:'read_file',
    kind:'file',
    target:'C:/tmp/monolith.txt',
    bytes:Buffer.from('MONOLITH TEST', 'utf8'),
    summary:'independent file observation',
    observedAt:'2026-09-04T07:05:00.000Z'
  });

  assert.deepEqual(validateEnrichedEvidence(entry), {ok:true});

  for (const field of ['missionId','stepId','tool','kind','target','observedAt','summary']) {
    let coerced = false;
    const poisoned = {
      ...entry,
      [field]: {
        toString() {
          coerced = true;
          return entry[field];
        }
      }
    };
    const result = validateEnrichedEvidence(poisoned);
    assert.equal(result.ok, false, `${field} object must be rejected`);
    assert.equal(result.reason, 'invalid_evidence_field_type');
    assert.equal(result.field, field);
    assert.equal(coerced, false, `${field} must not be string-coerced`);
  }

  const strict = new StrictEvidenceVerifier();
  const badStrict = strict.verify({
    evidence:[entry],
    checks:[{
      name:'strict bytes match',
      ok:true,
      evidenceIds:[{ toString() { throw new Error('must not coerce evidence ref'); } }]
    }]
  });
  assert.equal(badStrict.ok, false);
  assert.equal(badStrict.checks[0].evidenceRefsValid, false);
  assert.equal(badStrict.checks[0].bindingOk, false);

  const adversarial = new AdversarialEvidenceVerifier();
  const badAdversarial = adversarial.verify({
    evidence:[entry],
    checks:[{
      name:'counterexample absence',
      ok:true,
      severity:'critical',
      evidenceIds:[{ toString() { throw new Error('must not coerce evidence ref'); } }]
    }]
  });
  assert.equal(badAdversarial.ok, false);
  assert.equal(badAdversarial.checks[0].evidenceRefsValid, false);
  assert.equal(badAdversarial.criticalFailure, true);

  const verifier = new DualVerifier();
  const nonTextClaim = verifier.verify({
    claim:{ toString() { throw new Error('claim must not be coerced'); } },
    evidence:[entry],
    strictChecks:[],
    adversarialChecks:[]
  });
  assert.deepEqual(nonTextClaim, {ok:false, reason:'claim_required'});

  const pass = verifier.verify({
    claim:'file bytes match requested content',
    evidence:[entry],
    strictChecks:[{
      name:'strict byte equality',
      independenceKey:'strict-byte-equality',
      ok:true,
      evidenceIds:[entry.id]
    }],
    adversarialChecks:[{
      name:'adversarial independent observation',
      independenceKey:'adversarial-independent-observation',
      ok:true,
      severity:'critical',
      evidenceIds:[entry.id]
    }]
  });
  assert.equal(pass.ok, true);
  assert.equal(pass.reason, 'dual_verifier_pass');

  console.log('MONOLITH dual verifier evidence type boundary regression PASS');
})();
