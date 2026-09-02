'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { SignedUpdateLifecycle, stableStringify } = require('../src/signed-update-lifecycle');

(async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'llera-updater-rollback-temp-binding-'));
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const oldBytes = Buffer.from('LLera verified previous build');
  const newBytes = Buffer.from('LLera signed current build');
  const victimBytes = Buffer.from('do not overwrite me');
  const manifest = {
    product: 'LLera MONOLITH OMEGA',
    version: 'restore-rollback-temp-binding',
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
  await lifecycle.activateStaged(manifest, staged);
  assert.deepEqual(await fs.readFile(current), newBytes);

  const outsideVictim = path.join(tmp, 'outside-victim.bin');
  await fs.writeFile(outsideVictim, victimBytes);
  const rollbackTmp = `${current}.rollback`;
  await fs.symlink(outsideVictim, rollbackTmp, 'file');

  const rolledBack = await lifecycle.rollback();
  assert.deepEqual(await fs.readFile(current), oldBytes, 'rollback must restore verified backup bytes');
  assert.deepEqual(await fs.readFile(outsideVictim), victimBytes, 'pre-existing rollback symlink target must not be overwritten');
  const rollbackTmpExists = await fs.lstat(rollbackTmp).then(() => true, err => {
    if (err && err.code === 'ENOENT') return false;
    throw err;
  });
  assert.equal(rollbackTmpExists, false, 'rollback temporary path must be consumed/cleaned');
  assert.equal(rolledBack.restoredSha256, crypto.createHash('sha256').update(oldBytes).digest('hex'));

  console.log('signed update rollback temp binding PASS', {
    preexistingSymlinkRemoved: true,
    externalTargetPreserved: true,
    verifiedBackupRestored: true,
    rollbackTempCleaned: true
  });
})().catch(err => { console.error(err); process.exit(1); });
