'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { SignedUpdateLifecycle, stableStringify } = require('../src/signed-update-lifecycle');

(async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'llera-updater-backup-fail-'));
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const oldBytes = Buffer.from('LLera currently installed verified build');
  const newBytes = Buffer.from('LLera signed replacement build');
  const manifest = {
    product: 'LLera MONOLITH OMEGA',
    version: 'restore-backup-fail-closed',
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
  const backupFile = path.join(lifecycle.paths.backup, 'LLera.previous.bin');
  await fs.writeFile(currentFile, oldBytes);

  // Force copyFile(current, backup) to fail on every supported platform by
  // occupying the expected backup-file path with a directory.
  await fs.mkdir(backupFile, { recursive: true });

  await assert.rejects(
    lifecycle.activateStaged(manifest, staged),
    error => error && error.code === 'UPDATE_ROLLBACK_BACKUP_FAILED'
  );

  assert.deepEqual(await fs.readFile(currentFile), oldBytes, 'current install must remain byte-identical');
  assert.equal(progress.some(event => event.phase === 'activated'), false, 'activation progress must not be emitted');
  const journal = await lifecycle.readJournal();
  assert.equal(journal.state, 'staged', 'journal must not claim activation after backup failure');

  console.log('signed updater rollback-backup fail-closed regression PASS');
})().catch(error => { console.error(error); process.exit(1); });
