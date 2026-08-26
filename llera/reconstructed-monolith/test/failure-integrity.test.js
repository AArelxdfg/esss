'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { FailureDoctrine, FAILURE_CLASS } = require('../src/failure-doctrine');
const { IntegritySentinel, sha256Bytes, canonicalManifestPayload } = require('../src/integrity-sentinel');

const doctrine = new FailureDoctrine({ maxSameFailure: 2, maxTransientRetries: 2, clock: () => 123 });
let r = doctrine.recordFailure({ missionId: 'm1', stepId: 's1', tool: 'web_get', args: { url: 'x' }, error: { code: 'ETIMEDOUT', message: 'timed out' } });
assert.equal(r.failureClass, FAILURE_CLASS.TRANSIENT);
assert.equal(r.decision.action, 'retry-backoff');
r = doctrine.recordFailure({ missionId: 'm1', stepId: 's1', tool: 'web_get', args: { url: 'x' }, error: { code: 'ETIMEDOUT', message: 'timed out' } });
assert.equal(r.decision.action, 'change-strategy');
r = doctrine.recordFailure({ missionId: 'm1', stepId: 's2', tool: 'write_file', args: { path: 'a' }, material: true, error: new Error('write failed') });
assert.equal(r.decision.action, 'reobserve');
r = doctrine.recordFailure({ missionId: 'm1', stepId: 's3', tool: 'verify_artifact', error: { integrity: true, message: 'sha256 mismatch' } });
assert.equal(r.decision.action, 'quarantine');
assert.equal(doctrine.summarize('m1').total, 4);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llera-integrity-'));
fs.writeFileSync(path.join(root, 'app.bin'), Buffer.from('trusted-payload'));
const bytes = fs.readFileSync(path.join(root, 'app.bin'));
const manifest = { schema: 1, product: 'LLera', version: 'restore', files: [{ path: 'app.bin', size: bytes.length, sha256: sha256Bytes(bytes) }] };
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const signature = crypto.sign('sha256', Buffer.from(canonicalManifestPayload(manifest)), privateKey).toString('base64');
const sentinel = new IntegritySentinel({ rootDir: root, publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }) });
let trusted = sentinel.assertTrusted(manifest, signature, { requireSignature: true });
assert.equal(trusted.trusted, true);

fs.writeFileSync(path.join(root, 'app.bin'), Buffer.from('tampered'));
trusted = sentinel.assertTrusted(manifest, signature, { requireSignature: true });
assert.equal(trusted.trusted, false);
assert.equal(trusted.tree.failures[0].reason, 'size-mismatch');
const q = sentinel.quarantine('app.bin', 'sha256-mismatch');
assert.equal(q.moved, true);
assert.equal(fs.existsSync(path.join(root, 'app.bin')), false);
assert.equal(fs.existsSync(q.target), true);
assert.throws(() => sentinel.resolveSafe('../escape.bin'), /path escape blocked/);

console.log('failure-doctrine + integrity-sentinel PASS', { failures: doctrine.history.length, verifiedFiles: 1, quarantined: 1 });
