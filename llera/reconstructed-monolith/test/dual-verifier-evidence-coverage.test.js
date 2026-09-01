'use strict';

const assert = require('assert');
const { EvidenceLedger } = require('../src/evidence-ledger');
const { DualVerifier } = require('../src/dual-verifier');

const ledger = new EvidenceLedger({missionId:'mission-bind'});
const before = ledger.add({
  stepId:'observe-before',
  tool:'read_file',
  kind:'state',
  target:'C:/LLera/config.json',
  bytes:Buffer.from('{"mode":"old"}'),
  summary:'Observed the configuration before mutation'
});
const after = ledger.add({
  stepId:'observe-after',
  tool:'read_file',
  kind:'state',
  target:'C:/LLera/config.json',
  bytes:Buffer.from('{"mode":"new"}'),
  summary:'Observed the configuration after mutation'
});

const verifier = new DualVerifier();

const missingRefs = verifier.verify({
  claim:'config changed',
  evidence:[before, after],
  strictChecks:[{name:'state_changed',ok:true}],
  adversarialChecks:[{name:'counterexample_rejected',ok:true}]
});
assert.equal(missingRefs.ok, false);
assert.equal(missingRefs.reason, 'evidence_coverage_reject');
assert.equal(missingRefs.strict.checks[0].bindingOk, false);

const fakeRef = verifier.verify({
  claim:'config changed',
  evidence:[before, after],
  strictChecks:[{name:'state_changed',ok:true,evidenceIds:[before.id, after.id]}],
  adversarialChecks:[{name:'counterexample_rejected',ok:true,evidenceIds:['ev_' + '0'.repeat(24)]}]
});
assert.equal(fakeRef.ok, false);
assert(fakeRef.adversarial.checks[0].unknownEvidenceIds.length === 1);

const partialCoverage = verifier.verify({
  claim:'config changed',
  evidence:[before, after],
  strictChecks:[{name:'only_before',ok:true,evidenceIds:[before.id]}],
  adversarialChecks:[{name:'both',ok:true,evidenceIds:[before.id,after.id]}]
});
assert.equal(partialCoverage.ok, false);
assert.equal(partialCoverage.coverage.strict, 0.5);
assert.equal(partialCoverage.coverage.adversarial, 1);

const fullyBound = verifier.verify({
  claim:'config changed',
  evidence:[before, after],
  strictChecks:[
    {name:'before_bound',ok:true,evidenceIds:[before.id]},
    {name:'after_bound',ok:true,evidenceIds:[after.id]}
  ],
  adversarialChecks:[
    {name:'counterexample_rejected',ok:true,evidenceIds:[before.id,after.id]},
    {name:'independent_reobservation',ok:true,evidenceIds:[after.id]}
  ]
});
assert.equal(fullyBound.ok, true);
assert.equal(fullyBound.evidenceCoverage, 1);

console.log('MONOLITH dual verifier evidence coverage PASS', {
  missingRefsRejected:true,
  unknownRefsRejected:true,
  partialCoverageRejected:true,
  fullyBoundPass:true
});
