'use strict';
const assert = require('assert');
const { EvidenceLedger } = require('../src/evidence-ledger');
const { DualVerifier } = require('../src/dual-verifier');

const ledger = new EvidenceLedger({missionId:'mission-bind'});
const ev = ledger.add({stepId:'verify-step', kind:'artifact', target:'C:/LLera/LLera.exe', bytes:Buffer.from('verified')});
const verifier = new DualVerifier();
const checks = [{name:'bound',ok:true}];

assert.equal(verifier.verify({claim:'valid', evidence:[ev], strictChecks:checks, adversarialChecks:checks}).ok, true);

const fakeId = {...ev, id:'ev_' + 'a'.repeat(24)};
assert.equal(verifier.verify({claim:'fake id', evidence:[fakeId], strictChecks:checks, adversarialChecks:checks}).reason, 'evidence_id_binding_mismatch');

const retargeted = {...ev, target:'C:/LLera/Other.exe'};
assert.equal(verifier.verify({claim:'retarget', evidence:[retargeted], strictChecks:checks, adversarialChecks:checks}).reason, 'evidence_id_binding_mismatch');

const rehashed = {...ev, sha256:'b'.repeat(64)};
assert.equal(verifier.verify({claim:'rehash', evidence:[rehashed], strictChecks:checks, adversarialChecks:checks}).reason, 'evidence_id_binding_mismatch');

const incomplete = {id:ev.id, target:ev.target, sha256:ev.sha256};
assert.equal(verifier.verify({claim:'incomplete', evidence:[incomplete], strictChecks:checks, adversarialChecks:checks}).reason, 'incomplete_evidence_binding');

assert.equal(verifier.verify({claim:'duplicate', evidence:[ev, ev], strictChecks:checks, adversarialChecks:checks}).reason, 'duplicate_evidence_id');

console.log('MONOLITH evidence ID binding gate PASS', {
  authenticBinding:true,
  fakeIdRejected:true,
  retargetRejected:true,
  digestSubstitutionRejected:true,
  incompleteBindingRejected:true,
  duplicateRejected:true
});
