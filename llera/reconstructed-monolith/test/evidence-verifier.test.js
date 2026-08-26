'use strict';
const assert = require('assert');
const { EvidenceLedger, sha256 } = require('../src/evidence-ledger');
const { DualVerifier } = require('../src/dual-verifier');

const ledger = new EvidenceLedger({missionId:'mission-1'});
const bytes = Buffer.from('verified artifact bytes');
const ev = ledger.add({stepId:'step-verify', kind:'artifact', target:'C:/LLera/LLera.exe', bytes, metadata:{source:'post-action-read'}});
assert.ok(ev.id.startsWith('ev_'));
assert.equal(ev.sha256, sha256(bytes));
assert.equal(ledger.verifyBinding(ev.id, {target:'C:/LLera/LLera.exe', bytes}).ok, true);
assert.equal(ledger.verifyBinding(ev.id, {target:'C:/LLera/Other.exe', bytes}).reason, 'target_mismatch');
assert.equal(ledger.verifyBinding(ev.id, {target:'C:/LLera/LLera.exe', bytes:Buffer.from('tampered')}).reason, 'sha256_mismatch');
assert.throws(() => ledger.add({stepId:'s2', kind:'artifact', target:'x', bytes, digest:'0'.repeat(64)}), /digest mismatch/);

const verifier = new DualVerifier();
const pass = verifier.verify({
  claim:'material action produced expected target',
  evidence:[ev],
  strictChecks:[{name:'target_exists',ok:true},{name:'sha_bound',ok:true},{name:'expected_state',ok:true}],
  adversarialChecks:[{name:'tamper_attempt',ok:true},{name:'independent_observation',ok:true}]
});
assert.equal(pass.ok, true);

const reject = verifier.verify({
  claim:'weak claim', evidence:[ev],
  strictChecks:[{name:'one',ok:true},{name:'two',ok:false},{name:'three',ok:false}],
  adversarialChecks:[{name:'counterexample',ok:false},{name:'independent',ok:true}]
});
assert.equal(reject.ok, false);
assert.equal(reject.reason, 'dual_verifier_reject');

console.log('evidence + dual verifier PASS', {evidence:ledger.snapshot().length, strict:pass.strict.score, adversarial:pass.adversarial.score});
