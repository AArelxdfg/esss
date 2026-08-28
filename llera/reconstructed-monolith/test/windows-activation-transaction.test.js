'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { WindowsInstallLifecycle, sha256File } = require('../src/windows-packaging-lifecycle');

async function makeFixture({ healthy = true } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'llera-win-activation-'));
  const payload = path.join(root, 'payload.exe');
  await fsp.writeFile(payload, Buffer.from('new-build-bytes'));
  const expectedSha256 = crypto.createHash('sha256').update(Buffer.from('new-build-bytes')).digest('hex');
  let now = 1000;
  const lifecycle = new WindowsInstallLifecycle({
    rootDir: root,
    healthCheck: async () => healthy,
    launchApp: async () => {},
    stopApp: async () => {},
    now: () => ++now,
  });
  await lifecycle.init();
  return { root, payload, expectedSha256, lifecycle };
}

(async () => {
  const f = await makeFixture({ healthy: true });
  const current = path.join(f.root, 'app', 'LLera.exe');
  await fsp.writeFile(current, Buffer.from('old-build-bytes'));
  const originalRename = fsp.rename;
  let overwriteAttempts = 0;
  fsp.rename = async (src, dst) => {
    if (dst === current) {
      try {
        await fsp.access(dst);
        overwriteAttempts += 1;
        const error = new Error('simulated Windows destination exists');
        error.code = 'EEXIST';
        throw error;
      } catch (error) {
        if (error && error.code !== 'ENOENT') throw error;
      }
    }
    return originalRename.call(fsp, src, dst);
  };

  try {
    const installed = await f.lifecycle.install({
      payloadPath: f.payload,
      expectedSha256: f.expectedSha256,
      version: 'reconstructed-activation-test',
      selfTestTimeoutMs: 50
    });
    assert.strictEqual(installed.verified, true);
    assert.strictEqual(await sha256File(current), f.expectedSha256);
    assert.strictEqual(overwriteAttempts, 0, 'activation must not rename over an existing Windows destination');
  } finally {
    fsp.rename = originalRename;
  }

  const r = await makeFixture({ healthy: true });
  const rCurrent = path.join(r.root, 'app', 'LLera.exe');
  const rBackup = path.join(r.root, 'rollback', 'LLera.previous.exe');
  const displaced = `${rCurrent}.activation-old`;
  const previous = Buffer.from('known-good-old');
  const previousSha256 = crypto.createHash('sha256').update(previous).digest('hex');
  await fsp.writeFile(rBackup, previous);
  await fsp.writeFile(displaced, previous);
  await fsp.writeFile(rCurrent, Buffer.from('unverified-new'));
  await fsp.writeFile(path.join(r.root, 'install-journal.json'), JSON.stringify({
    state: 'activation-replacing',
    version: 'crash-sim',
    hadCurrent: true,
    previousSha256,
    sha256: crypto.createHash('sha256').update(Buffer.from('unverified-new')).digest('hex')
  }));

  const recovered = await r.lifecycle.recoverInterruptedInstall();
  assert.strictEqual(recovered.recovered, true);
  assert.strictEqual(recovered.action, 'rollback-activation');
  assert.strictEqual(await sha256File(rCurrent), previousSha256);
  assert.strictEqual(await exists(displaced), false);

  const sf = await makeFixture({ healthy: false });
  const sfCurrent = path.join(sf.root, 'app', 'LLera.exe');
  const sfOld = Buffer.from('old-self-test');
  const sfOldSha = crypto.createHash('sha256').update(sfOld).digest('hex');
  await fsp.writeFile(sfCurrent, sfOld);

  let failed = false;
  try {
    await sf.lifecycle.install({
      payloadPath: sf.payload,
      expectedSha256: sf.expectedSha256,
      version: 'self-test-fail',
      selfTestTimeoutMs: 1
    });
  } catch (error) {
    failed = /rollback completed/.test(String(error.message));
  }
  assert.strictEqual(failed, true);
  assert.strictEqual(await sha256File(sfCurrent), sfOldSha);

  console.log('MONOLITH Windows activation transaction PASS', {
    noRenameOverExistingDestination: true,
    interruptedActivationRestoresKnownGood: true,
    selfTestFailureRollbackRestoresKnownGood: true,
    activationDigestVerified: true
  });
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});

async function exists(file) {
  try { await fsp.access(file); return true; } catch { return false; }
}
