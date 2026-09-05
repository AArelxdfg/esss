'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { SignedUpdateLifecycle, stableStringify } = require('../src/signed-update-lifecycle');

function signedManifest(bytes, privateKey, version) {
  const manifest = {
    product: 'LLera MONOLITH OMEGA',
    version,
    artifact: {
      url: 'https://updates.invalid/llera.bin',
      size: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex')
    }
  };
  const signature = crypto.sign(null, Buffer.from(stableStringify(manifest)), privateKey).toString('base64');
  return { manifest, signature };
}

(async () => {
  if (process.platform === 'win32') {
    console.log('signed updater managed-path symlink regression SKIP: Windows symlink creation can require host policy privileges');
    return;
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const updateBytes = Buffer.from('LLera signed update bytes');

  // A redirected current directory must never let updater activation write outside its managed root.
  {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'llera-updater-current-link-'));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'llera-updater-outside-'));
    const lifecycle = new SignedUpdateLifecycle({ rootDir: tmp, publicKey });
    const { manifest, signature } = signedManifest(updateBytes, privateKey, 'symlink-current');
    lifecycle.verifySignedManifest(manifest, signature);
    await lifecycle.init();

    const downloaded = path.join(tmp, 'downloaded.bin');
    await fs.writeFile(downloaded, updateBytes);
    const staged = await lifecycle.stageArtifact(manifest, downloaded);
    await fs.symlink(outside, lifecycle.paths.current, 'dir');

    await assert.rejects(
      lifecycle.activateStaged(manifest, staged),
      error => error && error.code === 'UPDATE_MANAGED_PATH_UNSAFE',
      'activation must fail closed when current install directory is a symlink'
    );
    await assert.rejects(fs.access(path.join(outside, 'LLera.bin')), /ENOENT/, 'redirect target must remain untouched');
  }

  // A pre-created activation temporary-file symlink must not be followed or overwritten.
  {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'llera-updater-temp-link-'));
    const outside = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'llera-updater-temp-outside-')), 'outside.bin');
    const lifecycle = new SignedUpdateLifecycle({ rootDir: tmp, publicKey });
    const { manifest, signature } = signedManifest(updateBytes, privateKey, 'symlink-temp');
    lifecycle.verifySignedManifest(manifest, signature);
    await lifecycle.init();

    const downloaded = path.join(tmp, 'downloaded.bin');
    await fs.writeFile(downloaded, updateBytes);
    const staged = await lifecycle.stageArtifact(manifest, downloaded);
    await fs.mkdir(lifecycle.paths.current, { recursive: true });
    await fs.writeFile(outside, Buffer.from('DO NOT TOUCH'));
    await fs.symlink(outside, path.join(lifecycle.paths.current, 'LLera.bin.new'));

    await assert.rejects(
      lifecycle.activateStaged(manifest, staged),
      error => error && error.code === 'UPDATE_MANAGED_PATH_UNSAFE',
      'activation must reject a symlinked temporary activation path'
    );
    assert.equal((await fs.readFile(outside)).toString(), 'DO NOT TOUCH', 'outside symlink target must remain unchanged');
  }

  console.log('signed updater managed-path symlink regression PASS');
})().catch(error => { console.error(error); process.exit(1); });
