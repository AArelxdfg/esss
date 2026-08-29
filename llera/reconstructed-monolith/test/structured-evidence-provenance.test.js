'use strict';
const assert = require('assert');
const { EvidenceLedger, MAX_SUMMARY_BYTES, sha256 } = require('../src/evidence-ledger');
const { DualVerifier } = require('../src/dual-verifier');

const ledger = new EvidenceLedger({missionId:'mission-provenance'});
const bytes = Buffer.from('signed installer artifact bytes');
const longSummary = 'ğ'.repeat(600);
const ev = ledger.add({
  stepId:'verify-installer',
  tool:'hash_file',
  kind:'artifact',
  target:'C:/LLera/LLera_Setup.exe',
  bytes,
  byteCount:bytes.length,
  summary:longSummary,
  metadata:{source:'post-action-independent-read'}
});

assert.equal(ev.tool, 'hash_file');
assert.equal(ev.byteCount, bytes.length);
assert.equal(ev.sha256, sha256(bytes));
assert.ok(Buffer.byteLength(ev.summary, 'utf8') <= MAX_SUMMARY_BYTES);
assert.equal(ledger.verifyBinding(ev.id, {tool:'hash_file', target:ev.target, bytes}).ok, true);
assert.equal(ledger.verifyBinding(ev.id, {tool:'read_file', target:ev.target, bytes}).reason, 'tool_mismatch');
assert.throws(() => ledger.add({
  stepId:'bad-count', tool:'hash_file', kind:'artifact', target:'x', bytes, byteCount:bytes.length + 1
}), /byteCount mismatch/);

const verifier = new DualVerifier();
const checks = [{name:'bound', ok:true, evidenceIds:[ev.id]}];
assert.equal(verifier.verify({claim:'installer bytes verified', evidence:[ev], strictChecks:checks, adversarialChecks:checks}).ok, true);

const toolSubstitution = {...ev, tool:'read_file'};
assert.equal(
  verifier.verify({claim:'tool substituted', evidence:[toolSubstitution], strictChecks:checks, adversarialChecks:checks}).reason,
  'evidence_id_binding_mismatch'
);

const invalidCount = {...ev, byteCount:-1};
assert.equal(
  verifier.verify({claim:'invalid byte count', evidence:[invalidCount], strictChecks:checks, adversarialChecks:checks}).reason,
  'invalid_evidence_byte_count'
);

console.log('MONOLITH structured evidence provenance PASS', {
  evidenceId:ev.id,
  toolBound:true,
  byteCountBound:true,
  summaryBytes:Buffer.byteLength(ev.summary, 'utf8'),
  toolSubstitutionRejected:true
});
