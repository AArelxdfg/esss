'use strict';
const assert = require('assert');
const { EvidenceLedger } = require('../src/evidence-ledger');
const { StrictEvidenceVerifier, AdversarialEvidenceVerifier, DualVerifier } = require('../src/dual-verifier');

const ledger = new EvidenceLedger({missionId:'m-independent'});
const ev = ledger.add({stepId:'s1',kind:'state',target:'x',bytes:Buffer.from('x')});

const dual = new DualVerifier();
assert.notStrictEqual(dual.strictVerifier, dual.adversarialVerifier);
assert.notStrictEqual(dual.strictVerifier.engineId, dual.adversarialVerifier.engineId);

const pass = dual.verify({
  claim:'state is x', evidence:[ev],
  strictChecks:[{name:'strict-observation',ok:true,evidenceIds:[ev.id]}],
  adversarialChecks:[{name:'counterexample-search',ok:true,severity:'critical',evidenceIds:[ev.id]}]
});
assert.strictEqual(pass.ok,true);
assert.strictEqual(pass.independence.distinctInstances,true);
assert.strictEqual(pass.independence.distinctEngineIds,true);

const criticalReject = dual.verify({
  claim:'state is x', evidence:[ev],
  strictChecks:[{name:'strict-observation',ok:true,evidenceIds:[ev.id]}],
  adversarialChecks:[
    {name:'weak-check-1',ok:true,evidenceIds:[ev.id]},
    {name:'weak-check-2',ok:true,evidenceIds:[ev.id]},
    {name:'critical-counterexample',ok:false,severity:'critical',evidenceIds:[ev.id]}
  ]
});
assert.strictEqual(criticalReject.ok,false);
assert.strictEqual(criticalReject.adversarial.criticalFailure,true);
assert.strictEqual(criticalReject.adversarial.score,0);

const same = new StrictEvidenceVerifier({engineId:'same-engine'});
assert.throws(() => new DualVerifier({strictVerifier:same, adversarialVerifier:same}), /separate instances/);
assert.throws(() => new DualVerifier({
  strictVerifier:new StrictEvidenceVerifier({engineId:'same-engine'}),
  adversarialVerifier:new AdversarialEvidenceVerifier({engineId:'same-engine'})
}), /engineId must differ/);

const strict = new StrictEvidenceVerifier({threshold:1,engineId:'strict-custom'});
const adversarial = new AdversarialEvidenceVerifier({threshold:0.5,engineId:'adv-custom'});
const independent = new DualVerifier({strictVerifier:strict, adversarialVerifier:adversarial});
const result = independent.verify({
  claim:'independent policy', evidence:[ev],
  strictChecks:[
    {name:'s1',ok:true,evidenceIds:[ev.id]},
    {name:'s2',ok:false,evidenceIds:[ev.id]}
  ],
  adversarialChecks:[
    {name:'a1',ok:true,evidenceIds:[ev.id]},
    {name:'a2',ok:false,evidenceIds:[ev.id]}
  ]
});
assert.strictEqual(result.strict.score,0.5);
assert.strictEqual(result.strict.ok,false);
assert.strictEqual(result.adversarial.score,0.5);
assert.strictEqual(result.adversarial.ok,true);
assert.strictEqual(result.ok,false);

console.log('MONOLITH dual verifier structural independence PASS', {
  distinctClasses:true,
  distinctInstances:true,
  distinctEngineIds:true,
  independentPolicies:true,
  adversarialCriticalFailureFailClosed:true
});
