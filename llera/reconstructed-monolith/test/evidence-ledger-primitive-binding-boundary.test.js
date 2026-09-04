'use strict';

const assert = require('assert');
const { EvidenceLedger } = require('../src/evidence-ledger');

const digest = 'a'.repeat(64);
const coercive = { toString() { return 'coerced'; } };

assert.throws(() => new EvidenceLedger({missionId:coercive}), /missionId required/);

const ledger = new EvidenceLedger({missionId:'mission-primitive-boundary'});
const base = {
  stepId:'step-1',
  tool:'read_file',
  kind:'state',
  target:'C:/LLera/state.json',
  digest,
  metadata:{byteCount:0},
  summary:'Primitive binding boundary',
  observedAt:'2026-09-04T20:00:00.000Z'
};

for (const key of ['stepId','tool','kind','target']) {
  assert.throws(() => ledger.add({...base,[key]:coercive}), /stepId, tool, kind and target required/);
}
assert.throws(() => ledger.add({...base,digest:coercive}), /valid sha256 required/);

const metadata = JSON.parse('{"__proto__":{"polluted":true},"byteCount":0,"safe":"ok"}');
const entry = ledger.add({...base, metadata});
assert.strictEqual(Object.prototype.polluted, undefined);
assert.strictEqual(Object.prototype.hasOwnProperty.call(entry.metadata, '__proto__'), true);
assert.deepStrictEqual(entry.metadata.__proto__, {polluted:true});

assert.deepStrictEqual(ledger.verifyBinding(coercive,{target:base.target,tool:base.tool,bytes:Buffer.alloc(0)}), {
  ok:false,
  reason:'evidence_id_required'
});
assert.strictEqual(ledger.verifyBinding(entry.id,{target:coercive,tool:base.tool,bytes:Buffer.alloc(0)}).reason,'target_required');
assert.strictEqual(ledger.verifyBinding(entry.id,{target:base.target,tool:coercive,bytes:Buffer.alloc(0)}).reason,'tool_required');
assert.strictEqual(ledger.verifyBinding(entry.id,{target:base.target,tool:base.tool,bytes:Buffer.alloc(0),digest:coercive}).reason,'digest_mismatch');

console.log('MONOLITH evidence primitive binding boundary PASS', {
  coerciveIdentityRejected:true,
  coerciveDigestRejected:true,
  prototypeKeyPreservedWithoutPollution:true
});
