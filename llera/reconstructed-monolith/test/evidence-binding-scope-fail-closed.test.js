'use strict';

const assert = require('assert');
const { EvidenceLedger } = require('../src/evidence-ledger');

const ledger = new EvidenceLedger({missionId:'mission-scope'});
const bytes = Buffer.from('artifact-v1');
const entry = ledger.add({
  stepId:'step-build',
  tool:'hash_file',
  kind:'artifact',
  target:'C:/LLera/LLera.exe',
  bytes
});

assert.deepEqual(
  ledger.verifyBinding(entry.id, {digest:entry.sha256}),
  {ok:false, reason:'target_required'},
  'digest-only verification must not detach evidence from its target'
);

assert.deepEqual(
  ledger.verifyBinding(entry.id, {target:entry.target, digest:entry.sha256}),
  {ok:false, reason:'tool_required'},
  'tool-bound evidence must require tool provenance during verification'
);

assert.deepEqual(
  ledger.verifyBinding(entry.id, {tool:'read_file', target:entry.target, digest:entry.sha256}),
  {ok:false, reason:'tool_mismatch'},
  'wrong producer tool must not verify the same target/digest'
);

assert.deepEqual(
  ledger.verifyBinding(entry.id, {tool:entry.tool, target:'C:/LLera/Other.exe', digest:entry.sha256}),
  {ok:false, reason:'target_mismatch'},
  'retargeting must fail even with authentic digest and tool'
);

const ok = ledger.verifyBinding(entry.id, {
  tool:entry.tool,
  target:entry.target,
  bytes
});
assert.equal(ok.ok, true, 'exact tool + target + bytes binding must verify');

const legacy = ledger.add({
  stepId:'step-observe',
  kind:'observation',
  target:'system://health',
  bytes:Buffer.from('healthy')
});
assert.equal(
  ledger.verifyBinding(legacy.id, {target:legacy.target, bytes:Buffer.from('healthy')}).ok,
  true,
  'pre-tool evidence remains verifiable without inventing tool provenance'
);
assert.deepEqual(
  ledger.verifyBinding(legacy.id, {tool:'system_info', target:legacy.target, digest:legacy.sha256}),
  {ok:false, reason:'tool_mismatch'},
  'pre-tool evidence must not accept post-hoc tool attribution'
);

console.log('MONOLITH_EVIDENCE_SCOPE_FAIL_CLOSED_PASS', {
  digestOnlyRejected:true,
  toolRequired:true,
  wrongToolRejected:true,
  retargetRejected:true,
  exactBindingVerified:true,
  legacyCompatibilityPreserved:true
});
