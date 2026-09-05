'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const { SignedUpdateLifecycle, stableStringify } = require('../src/signed-update-lifecycle');

function signedManifest(privateKey, bytes, version = 'download-symlink') {
  const manifest = {
    version,
    artifact: {
      url: 'https://updates.example.invalid/LLera.bin',
      size: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex')
    }
  };
  const signature = crypto.sign(null, Buffer.from(stableStringify(manifest)), privateKey).toString('base64');
  return { manifest, signature };
}

async function main() {
  if (process.platform === 'win32') {
    console.log('SKIP signed-update-download-part-symlink: symlink creation may require Windows developer/admin privileges');
    return;
  }

  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'llera-updater-part-link-'));
  const outside = await fsp.mkdtemp(path.join(os.tmpdir(), 'llera-updater-outside-'));
  try {
    const victim = path.join(outside, 'victim.bin');
    const original = Buffer.from('DO NOT TOUCH');
    await fsp.writeFile(victim, original);

    const updateBytes = Buffer.from('SIGNED LLERA UPDATE');
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const { manifest, signature } = signedManifest(privateKey, updateBytes);
    let fetchCalls = 0;
    const lifecycle = new SignedUpdateLifecycle({
      rootDir: root,
      publicKey,
      fetchImpl: async () => {
        fetchCalls += 1;
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          body: (async function* () { yield updateBytes; })()
        };
      }
    });

    lifecycle.verifySignedManifest(manifest, signature);
    await lifecycle.init();

    const partPath = path.join(root, 'downloads', `${manifest.version}.bin.part`);
    await fsp.symlink(victim, partPath, 'file');

    await assert.rejects(
      () => lifecycle.downloadArtifact(manifest),
      error => error && error.code === 'UPDATE_MANAGED_PATH_UNSAFE',
      'partial download symlink must fail closed before any network fetch or write'
    );

    assert.strictEqual(fetchCalls, 0, 'unsafe managed download path must be rejected before fetch');
    assert.deepStrictEqual(await fsp.readFile(victim), original, 'external symlink target must remain unchanged');
    assert.strictEqual((await fsp.lstat(partPath)).isSymbolicLink(), true, 'test must exercise a real symlink');
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(outside, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
