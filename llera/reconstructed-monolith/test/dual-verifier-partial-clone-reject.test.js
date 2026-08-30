'use strict';

const assert = require('assert');
const { EvidenceLedger } = require('../src/evidence-ledger');
const { DualVerifier } = require('../src/dual-verifier');

const ledger = new EvidenceLedger({missionId:'mission-dual-partial-clone'});
const evidence = ledger.add({
  stepId:'verify-output',
  tool:'hash_file',
  kind:'artifact',
  target:'C:/LLera/output.bin',
  bytes:Buffer.from('verified-output')
});

const verifier = new DualVerifier();
const cloned = {
  name:'artifact_matches',
  detail:'hash matches expected artifact',
  ok:true,
  evidenceIds:[evidence.id]
};

const partialCloneResult = verifier.verify({
  claim:'artifact is valid',
  evidence:[evidence],
  strictChecks:[cloned],
  adversarialChecks:[
    {
      name:'artifact_matches',
      detail:'hash matches expected artifact',
      ok:true,
      evidenceIds:[evidence.id]
    },
    {
      name:'tamper_counterexample_rejected',
      detail:'independent adversarial path found no alternate bytes for the bound target',
      ok:true,
      evidenceIds:[evidence.id]
    }
  ]
});
assert.equal(partialCloneResult.ok, false);
assert.equal(partialCloneResult.reason, 'verifier_independence_reject');
assert.equal(partialCloneResult.independence.reason, 'overlapping_verifier_checks');
assert.equal(partialCloneResult.independence.sharedCount, 1);

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

console.log('MONOLITH dual verifier partial-clone guard PASS', {
  partialCloneRejected:true,
  independentChannelsPass:true
});
