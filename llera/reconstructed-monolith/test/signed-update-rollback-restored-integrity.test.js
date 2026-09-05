'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { SignedUpdateLifecycle, stableStringify } = require('../src/signed-update-lifecycle');

(async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'llera-updater-rollback-integrity-'));
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const oldBytes = Buffer.from('LLera verified previous install bytes');
  const newBytes = Buffer.from('LLera verified signed update bytes');
  const oldSha256 = crypto.createHash('sha256').update(oldBytes).digest('hex');
  const manifest = {
    product: 'LLera MONOLITH OMEGA',
    version: 'restore-rollback-integrity',
    artifact: {
      url: 'https://updates.invalid/llera.bin',
      size: newBytes.length,
      sha256: crypto.createHash('sha256').update(newBytes).digest('hex')
    }
  };
  const signature = crypto.sign(null, Buffer.from(stableStringify(manifest)), privateKey).toString('base64');
  const progress = [];
  const lifecycle = new SignedUpdateLifecycle({ rootDir: tmp, publicKey, onProgress: event => progress.push(event) });
  lifecycle.verifySignedManifest(manifest, signature);
  await lifecycle.init();

  const downloaded = path.join(tmp, 'downloaded.bin');
  await fs.writeFile(downloaded, newBytes);
  const staged = await lifecycle.stageArtifact(manifest, downloaded);

  await fs.mkdir(lifecycle.paths.current, { recursive: true });
  const currentFile = path.join(lifecycle.paths.current, 'LLera.bin');
  await fs.writeFile(currentFile, oldBytes);

  const activated = await lifecycle.activateStaged(manifest, staged);
  assert.equal(activated.backupAvailable, true, 'existing install must produce a rollback backup');
  assert.equal(activated.backupSha256, oldSha256, 'backup digest must bind to previous install bytes');
  assert.deepEqual(await fs.readFile(currentFile), newBytes, 'activation must install the signed update bytes');

  const rolledBack = await lifecycle.rollback();
  const restoredBytes = await fs.readFile(currentFile);
  const restoredSha256 = crypto.createHash('sha256').update(restoredBytes).digest('hex');

  assert.deepEqual(restoredBytes, oldBytes, 'rollback must restore the exact previous install bytes');
  assert.equal(restoredSha256, oldSha256, 'actual restored bytes must match the recorded rollback digest');
  assert.equal(rolledBack.restoredSha256, oldSha256, 'rollback result must report the digest of the restored current install');

  const journal = await lifecycle.readJournal();
  assert.equal(journal.state, 'rolled-back', 'journal must only claim rolled-back after restored-byte verification');
  assert.equal(journal.restoredSha256, oldSha256, 'journal restoredSha256 must bind to actual current bytes');
  assert.equal(journal.expectedBackupSha256, oldSha256, 'journal must preserve expected backup digest');
  assert.equal(progress.some(event => event.phase === 'rolled-back' && event.percent === 100), true, 'success progress must be emitted after rollback verification');

  console.log('signed updater restored-byte rollback integrity regression PASS');
})().catch(error => { console.error(error); process.exit(1); });
