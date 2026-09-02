'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { SignedUpdateLifecycle, stableStringify } = require('../src/signed-update-lifecycle');

(async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'llera-updater-activation-atomicity-'));
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const oldBytes = Buffer.from('LLera verified current build');
  const newBytes = Buffer.from('LLera signed candidate build');
  const manifest = {
    product: 'LLera MONOLITH OMEGA',
    version: 'restore-activation-atomicity',
    artifact: {
      url: 'https://updates.invalid/llera.bin',
      size: newBytes.length,
      sha256: crypto.createHash('sha256').update(newBytes).digest('hex')
    }
  };
  const signature = crypto.sign(null, Buffer.from(stableStringify(manifest)), privateKey).toString('base64');
  const lifecycle = new SignedUpdateLifecycle({ rootDir: tmp, publicKey });
  lifecycle.verifySignedManifest(manifest, signature);
  await lifecycle.init();

  const stageDir = path.join(lifecycle.paths.staging, manifest.version);
  const staged = path.join(stageDir, 'LLera-update.bin');
  await fs.mkdir(stageDir, { recursive: true });
  await fs.writeFile(staged, newBytes);

  const current = path.join(lifecycle.paths.current, 'LLera.bin');
  await fs.mkdir(lifecycle.paths.current, { recursive: true });
  await fs.writeFile(current, oldBytes);

  const externalSameDigest = path.join(tmp, 'external-same-digest.bin');
  await fs.writeFile(externalSameDigest, newBytes);
  await assert.rejects(
    lifecycle.activateStaged(manifest, externalSameDigest),
    /activation staged path binding mismatch/
  );
  assert.deepEqual(await fs.readFile(current), oldBytes, 'external staged path rejection must preserve current build');

  const backupFile = path.join(lifecycle.paths.backup, 'LLera.previous.bin');
  await fs.mkdir(backupFile, { recursive: true });
  await fs.writeFile(path.join(backupFile, 'blocker'), Buffer.from('force backup replacement failure'));
  await assert.rejects(
    lifecycle.activateStaged(manifest, staged),
    /activation backup failed/
  );
  assert.deepEqual(await fs.readFile(current), oldBytes, 'backup failure must fail closed before activation');
  const journalAfterFailure = await lifecycle.readJournal();
  assert.equal(journalAfterFailure, null, 'failed activation must not claim an activated journal state');

  await fs.rm(backupFile, { recursive: true, force: true });
  const activated = await lifecycle.activateStaged(manifest, staged);
  assert.equal(activated.backupAvailable, true);
  assert.deepEqual(await fs.readFile(current), newBytes);
  assert.deepEqual(await fs.readFile(backupFile), oldBytes);
  assert.equal(activated.backupSha256, crypto.createHash('sha256').update(oldBytes).digest('hex'));

  console.log('signed update activation backup atomicity PASS', {
    canonicalStageBound: true,
    backupFailureFailClosed: true,
    currentPreservedOnFailure: true,
    verifiedBackupBeforeActivation: true
  });
})().catch(err => { console.error(err); process.exit(1); });
