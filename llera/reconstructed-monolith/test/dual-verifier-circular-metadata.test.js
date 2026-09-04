'use strict';

const assert = require('assert');
const { EvidenceLedger } = require('../src/evidence-ledger');
const { DualVerifier } = require('../src/dual-verifier');

const ledger = new EvidenceLedger({missionId:'mission-circular-verifier'});
const evidence = ledger.add({
  stepId:'observe',
  tool:'filesystem.read',
  kind:'artifact',
  target:'C:/LLera/circular-proof.bin',
  bytes:Buffer.from('verified-circular-proof'),
  summary:'Observed artifact for circular verifier metadata regression.'
});

const verifier = new DualVerifier();
const circular = {
  name:'strict-circular-metadata',
  ok:true,
  evidenceIds:[evidence.id]
};
circular.metadata = circular;

const result = verifier.verify({
  claim:'circular verifier metadata must fail closed',
  evidence:[evidence],
  strictChecks:[circular],
  adversarialChecks:[{
    name:'adversarial-independent-observation',
    ok:true,
    severity:'critical',
    evidenceIds:[evidence.id]
  }]
});

assert.strictEqual(result.ok, false);
assert.strictEqual(result.reason, 'verifier_check_metadata_invalid');

const valid = verifier.verify({
  claim:'valid independent verifier metadata remains accepted',
  evidence:[evidence],
  strictChecks:[{
    name:'strict-live-observation',
    ok:true,
    evidenceIds:[evidence.id]
  }],
  adversarialChecks:[{
    name:'adversarial-independent-reobservation',
    ok:true,
    severity:'critical',
    evidenceIds:[evidence.id]
  }]
});
assert.strictEqual(valid.ok, true);
assert.strictEqual(valid.reason, 'dual_verifier_pass');

console.log('MONOLITH dual verifier circular metadata PASS', {
  circularMetadataRejected:true,
  validIndependentChecksPreserved:true
});
