'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { SignedUpdateLifecycle, stableStringify } = require('../src/signed-update-lifecycle');

(async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'llera-updater-'));
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const oldBytes = Buffer.from('LLera old verified build');
  const newBytes = Buffer.from('LLera new signed MONOLITH build');
  const manifest = {
    product: 'LLera MONOLITH OMEGA', version: 'restore-0.1.0',
    artifact: { url: 'https://updates.invalid/llera.bin', size: newBytes.length, sha256: crypto.createHash('sha256').update(newBytes).digest('hex') }
  };
  const signature = crypto.sign(null, Buffer.from(stableStringify(manifest)), privateKey).toString('base64');
  const progress = [];
  let rangeSeen = false;
  const fetchImpl = async (_url, opts = {}) => {
    const range = opts.headers && opts.headers.Range;
    let body = newBytes; let status = 200;
    if (range) { rangeSeen = true; const n = Number(range.match(/bytes=(\d+)-/)[1]); body = newBytes.subarray(n); status = 206; }
    return { ok: true, status, body: Readable.from([body]) };
  };
  const lifecycle = new SignedUpdateLifecycle({ rootDir: tmp, publicKey, fetchImpl, onProgress: e => progress.push(e) });
  assert.equal(lifecycle.verifySignedManifest(manifest, signature).verified, true);
  assert.throws(() => lifecycle.verifySignedManifest({ ...manifest, version: 'tampered' }, signature), /signature invalid/);
  await lifecycle.init();
  await fs.writeFile(path.join(lifecycle.paths.downloads, `${manifest.version}.bin.part`), newBytes.subarray(0, 7));
  const downloaded = await lifecycle.downloadArtifact(manifest, { resume: true });
  assert.equal(rangeSeen, true);
  assert.equal(downloaded.sha256, manifest.artifact.sha256);
  const staged = await lifecycle.stageArtifact(manifest, downloaded.path);
  await fs.mkdir(lifecycle.paths.current, { recursive: true });
  const current = path.join(lifecycle.paths.current, 'LLera.bin');
  await fs.writeFile(current, oldBytes);
  const activated = await lifecycle.activateStaged(manifest, staged);
  assert.equal((await fs.readFile(activated.currentFile)).toString(), newBytes.toString());
  assert.equal(activated.backupAvailable, true);
  const rolled = await lifecycle.rollback();
  assert.equal((await fs.readFile(rolled.currentFile)).toString(), oldBytes.toString());
  assert(progress.some(x => x.phase === 'download'));
  assert(progress.some(x => x.phase === 'activated'));
  assert(progress.some(x => x.phase === 'rolled-back'));
  console.log('signed updater lifecycle PASS', { resume: rangeSeen, progressEvents: progress.length, rollback: true });
})().catch(err => { console.error(err); process.exit(1); });
