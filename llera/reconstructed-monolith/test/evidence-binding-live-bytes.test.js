'use strict';
const assert = require('assert');
const { EvidenceLedger, sha256 } = require('../src/evidence-ledger');

const ledger = new EvidenceLedger({missionId:'mission-live-bytes'});
const bytes = Buffer.from('artifact-v1');
const ev = ledger.add({stepId:'verify', kind:'artifact', target:'C:/LLera/LLera.exe', bytes});

assert.deepEqual(ledger.verifyBinding(ev.id, {target:ev.target, bytes}), {ok:true, entry:ev});
assert.equal(ledger.verifyBinding(ev.id, {target:ev.target, digest:ev.sha256}).reason, 'bytes_required');
assert.equal(ledger.verifyBinding(ev.id, {bytes}).reason, 'target_required');
assert.equal(ledger.verifyBinding(ev.id, {target:ev.target, bytes:Buffer.from('artifact-v2')}).reason, 'sha256_mismatch');
assert.equal(ledger.verifyBinding(ev.id, {target:ev.target, bytes, digest:sha256('other')}).reason, 'digest_mismatch');

console.log('MONOLITH evidence live-byte binding gate PASS');
