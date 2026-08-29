'use strict';

const assert = require('assert');
const { EvidenceLedger } = require('../src/evidence-ledger');
const { DualVerifier } = require('../src/dual-verifier');

const ledger = new EvidenceLedger({missionId:'mission-dual-independent'});
const evidence = ledger.add({
  stepId:'verify-output',
  tool:'hash_file',
  kind:'artifact',
  target:'C:/LLera/output.bin',
  bytes:Buffer.from('verified-output')
});
const verifier = new DualVerifier();

const sharedArray = [{
  name:'artifact_matches',
  detail:'hash matches expected artifact',
  ok:true,
  evidenceIds:[evidence.id]
}];
const sharedArrayResult = verifier.verify({
  claim:'artifact is valid',
  evidence:[evidence],
  strictChecks:sharedArray,
  adversarialChecks:sharedArray
});
assert.equal(sharedArrayResult.ok, false);
assert.equal(sharedArrayResult.reason, 'verifier_independence_reject');
assert.equal(sharedArrayResult.independence.reason, 'shared_check_array');

const sharedObject = {
  name:'artifact_matches',
  detail:'hash matches expected artifact',
  ok:true,
  evidenceIds:[evidence.id]
};
const sharedObjectResult = verifier.verify({
  claim:'artifact is valid',
  evidence:[evidence],
  strictChecks:[sharedObject],
  adversarialChecks:[sharedObject]
});
assert.equal(sharedObjectResult.ok, false);
assert.equal(sharedObjectResult.independence.reason, 'shared_check_object');

const copiedResult = verifier.verify({
  claim:'artifact is valid',
  evidence:[evidence],
  strictChecks:[{
    name:'artifact_matches',
    detail:'hash matches expected artifact',
    ok:true,
    evidenceIds:[evidence.id]
  }],
  adversarialChecks:[{
    name:'artifact_matches',
    detail:'hash matches expected artifact',
    ok:true,
    evidenceIds:[evidence.id]
  }]
});
assert.equal(copiedResult.ok, false);
assert.equal(copiedResult.independence.reason, 'identical_verifier_checks');

const independentResult = verifier.verify({
  claim:'artifact is valid',
  evidence:[evidence],
  strictChecks:[{
    name:'artifact_matches',
    detail:'hash matches expected artifact',
    ok:true,
    evidenceIds:[evidence.id]
  }],
  adversarialChecks:[{
    name:'tamper_counterexample_rejected',
    detail:'independent adversarial path found no alternate bytes for the bound target',
    ok:true,
    evidenceIds:[evidence.id]
  }]
});
assert.equal(independentResult.ok, true);
assert.equal(independentResult.reason, 'dual_verifier_pass');
assert.equal(independentResult.independence.reason, 'independent_verifier_channels');

console.log('MONOLITH dual verifier independence PASS', {
  sharedArrayRejected:true,
  sharedObjectRejected:true,
  copiedChecksRejected:true,
  independentChannelsPass:true
});
