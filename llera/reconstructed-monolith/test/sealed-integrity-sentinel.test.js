'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SealedIntegritySentinel, sha256 } = require('../src/sealed-integrity-sentinel');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llera-sealed-integrity-'));
const storePath = path.join(dir, 'integrity-v2.json');
const target = path.join(dir, 'LLera.exe');
let tick = 0;
const now = () => `2026-08-28T08:41:${String(++tick).padStart(2,'0')}+03:00`;

fs.writeFileSync(target, 'verified-v1');
let sentinel = new SealedIntegritySentinel(storePath, { now });
const baseline = sentinel.baseline(target, { role:'installed-app' });
assert.strictEqual(baseline.sha256, sha256(Buffer.from('verified-v1')));
assert.strictEqual(sentinel.check(target).ok, true);

fs.writeFileSync(target, 'tampered-v2');
const incident = sentinel.check(target);
assert.strictEqual(incident.quarantined, true);
const current = sha256(fs.readFileSync(target));
assert.strictEqual(sentinel.release(target, current, 'verified-local-repair').released, true);
assert.strictEqual(sentinel.check(target).ok, true);

// A release must never bless bytes that changed after the quarantine incident was
// recorded. The new bytes need their own sealed observation before release.
fs.writeFileSync(target, 'tampered-v3');
const staleIncident = sentinel.check(target);
assert.strictEqual(staleIncident.quarantined, true);
fs.writeFileSync(target, 'tampered-v4-after-observation');
const changedAfterObservation = sha256(fs.readFileSync(target));
assert.throws(
  () => sentinel.release(target, changedAfterObservation, 'verified-local-repair'),
  /SEALED_RELEASE_REOBSERVATION_REQUIRED/
);
assert.strictEqual(sentinel.isQuarantined(target), true);
const freshIncident = sentinel.check(target);
assert.strictEqual(freshIncident.quarantined, true);
assert.notStrictEqual(freshIncident.incidentId, staleIncident.incidentId);
assert.strictEqual(
  sentinel.release(target, changedAfterObservation, 'verified-local-repair').incidentId,
  freshIncident.incidentId
);
assert.strictEqual(sentinel.check(target).ok, true);

let store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
const key = Object.keys(store.baselines)[0];
store.baselines[key].sha256 = '0'.repeat(64);
fs.writeFileSync(storePath, JSON.stringify(store));
assert.throws(() => new SealedIntegritySentinel(storePath, { now }), /BASELINE_TAMPERED/);

fs.unlinkSync(storePath);
fs.writeFileSync(target, 'verified-v5');
sentinel = new SealedIntegritySentinel(storePath, { now });
sentinel.baseline(target, { role:'installed-app' });
store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
store.quarantine.fake = { incidentId:'fake', reason:'forged' };
fs.writeFileSync(storePath, JSON.stringify(store));
assert.throws(() => new SealedIntegritySentinel(storePath, { now }), /STATE_TAMPERED/);

console.log('MONOLITH current-baseline sealed Integrity Sentinel PASS');
