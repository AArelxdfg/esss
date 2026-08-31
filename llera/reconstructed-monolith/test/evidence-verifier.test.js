'use strict';
const assert = require('assert');
const { EvidenceLedger, sha256 } = require('../src/evidence-ledger');
const { DualVerifier } = require('../src/dual-verifier');

const ledger = new EvidenceLedger({missionId:'mission-1'});
const bytes = Buffer.from('verified artifact bytes');
const ev = ledger.add({stepId:'step-verify', tool:'read_file', kind:'artifact', target:'C:/LLera/LLera.exe', bytes, summary:'Read the executable after the material action', metadata:{source:'post-action-read'}});
assert.ok(ev.id.startsWith('ev_'));
assert.equal(ev.sha256, sha256(bytes));
assert.equal(ledger.verifyBinding(ev.id, {target:'C:/LLera/LLera.exe', tool:'read_file', bytes}).ok, true);
assert.equal(ledger.verifyBinding(ev.id, {target:'C:/LLera/Other.exe', tool:'read_file', bytes}).reason, 'target_mismatch');
assert.equal(ledger.verifyBinding(ev.id, {target:'C:/LLera/LLera.exe', tool:'read_file', bytes:Buffer.from('tampered artifact bytes')}).reason, 'sha256_mismatch');
assert.throws(() => ledger.add({stepId:'s2', tool:'read_file', kind:'artifact', target:'x', bytes, digest:'0'.repeat(64), summary:'Digest mismatch probe'}), /digest mismatch/);

const verifier = new DualVerifier();
const pass = verifier.verify({
  claim:'material action produced expected target',
  evidence:[ev],
  strictChecks:[
    {name:'target_exists',ok:true,evidenceIds:[ev.id]},
    {name:'sha_bound',ok:true,evidenceIds:[ev.id]},
    {name:'expected_state',ok:true,evidenceIds:[ev.id]}
  ],
  adversarialChecks:[
    {name:'tamper_attempt',ok:true,evidenceIds:[ev.id]},
    {name:'independent_observation',ok:true,evidenceIds:[ev.id]}
  ]
});
assert.equal(pass.ok, true);
assert.equal(pass.evidenceCoverage, 1);

const reject = verifier.verify({
  claim:'weak claim', evidence:[ev],
  strictChecks:[
    {name:'one',ok:true,evidenceIds:[ev.id]},
    {name:'two',ok:false,evidenceIds:[ev.id]},
    {name:'three',ok:false,evidenceIds:[ev.id]}
  ],
  adversarialChecks:[
    {name:'counterexample',ok:false,evidenceIds:[ev.id]},
    {name:'independent',ok:true,evidenceIds:[ev.id]}
  ]
});
assert.equal(reject.ok, false);
assert.equal(reject.reason, 'dual_verifier_reject');

console.log('evidence + dual verifier PASS', {evidence:ledger.snapshot().length, strict:pass.strict.score, adversarial:pass.adversarial.score});
