'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SealedIntegritySentinel, sha256 } = require('../src/sealed-integrity-sentinel');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llera-rebaseline-guard-'));
const store = path.join(dir, 'integrity.json');
const target = path.join(dir, 'LLera.exe');
let tick = 0;
const now = () => `2026-08-28T17:50:${String(++tick).padStart(2,'0')}+03:00`;

fs.writeFileSync(target, 'trusted-v1');
const sentinel = new SealedIntegritySentinel(store, { now });
const first = sentinel.baseline(target, {role:'installed-app'});

const again = sentinel.baseline(target, {role:'ignored-change'});
assert.strictEqual(again.idempotent, true);
assert.strictEqual(again.sha256, first.sha256);
assert.strictEqual(again.role, 'installed-app');

fs.writeFileSync(target, 'tampered-v2');
assert.throws(
  () => sentinel.baseline(target, {role:'installed-app'}),
  /SEALED_REBASELINE_REQUIRES_RELEASE/
);
assert.strictEqual(sentinel.state.baselines[first.target].sha256, sha256(Buffer.from('trusted-v1')));

const incident = sentinel.check(target);
assert.strictEqual(incident.quarantined, true);
const incidentCount = sentinel.state.incidents.length;
const repeated = sentinel.check(target);
assert.strictEqual(repeated.duplicateSuppressed, true);
assert.strictEqual(sentinel.state.incidents.length, incidentCount);

const repairedDigest = sha256(fs.readFileSync(target));
const released = sentinel.release(target, repairedDigest, 'verified-local-repair');
assert.strictEqual(released.released, true);
assert.strictEqual(sentinel.check(target).ok, true);
assert.strictEqual(sentinel.isQuarantined(target), false);

console.log('MONOLITH Integrity Sentinel rebaseline guard PASS', {
  idempotentBaseline:true,
  silentRebaselineBlocked:true,
  duplicateIncidentSuppressed:true,
  explicitReleaseRequired:true
});
