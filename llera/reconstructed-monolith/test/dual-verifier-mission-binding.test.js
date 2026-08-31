'use strict';

const assert = require('assert');
const { EvidenceLedger } = require('../src/evidence-ledger');
const { DualVerifier } = require('../src/dual-verifier');

const a = new EvidenceLedger({missionId:'mission-a'}).add({
  stepId:'observe-a', kind:'state', target:'C:/LLera/config.json', bytes:Buffer.from('a')
});
const b = new EvidenceLedger({missionId:'mission-b'}).add({
  stepId:'observe-b', kind:'state', target:'C:/LLera/config.json', bytes:Buffer.from('b')
});

const result = new DualVerifier().verify({
  claim:'config verified',
  evidence:[a,b],
  strictChecks:[{name:'strict',ok:true,evidenceIds:[a.id,b.id]}],
  adversarialChecks:[{name:'countercheck',ok:true,evidenceIds:[a.id,b.id]}]
});

assert.equal(result.ok, false);
assert.equal(result.reason, 'mixed_mission_evidence_reject');
console.log('MONOLITH dual verifier mission binding PASS');
