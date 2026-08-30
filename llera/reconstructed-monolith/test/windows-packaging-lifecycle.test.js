'use strict';

const assert = require('assert');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WindowsInstallLifecycle, CrashLoopWatchdog } = require('../src/windows-packaging-lifecycle');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'llera-winpack-'));
  const oldPayload = path.join(root, 'old.exe');
  const newPayload = path.join(root, 'new.exe');
  await fs.writeFile(oldPayload, 'old-verified-payload');
  await fs.writeFile(newPayload, 'new-verified-payload');
  const sha = value => crypto.createHash('sha256').update(value).digest('hex');
  const oldSha = sha('old-verified-payload');
  const newSha = sha('new-verified-payload');

  let healthy = true;
  const lifecycle = new WindowsInstallLifecycle({ rootDir: root, healthCheck: async () => healthy });
  await lifecycle.install({ payloadPath: oldPayload, expectedSha256: oldSha, version: '5.3.5' });
  assert.strictEqual((await fs.readFile(path.join(root, 'app', 'LLera.exe'))).toString(), 'old-verified-payload');

  const verifiedNew = await lifecycle.install({ payloadPath: newPayload, expectedSha256: newSha, version: '5.4.0-reconstructed' });
  assert.strictEqual(verifiedNew.verified, true);
  assert.strictEqual(verifiedNew.hadCurrent, true);
  assert.strictEqual(verifiedNew.previousSha256, oldSha);
  assert.strictEqual((await fs.readFile(path.join(root, 'app', 'LLera.exe'))).toString(), 'new-verified-payload');
  const postInstallRollback = await lifecycle.rollbackVerifiedInstall({ version: verifiedNew.version, expectedSha256: verifiedNew.sha256, hadCurrent: verifiedNew.hadCurrent, previousSha256: verifiedNew.previousSha256 });
  assert.strictEqual(postInstallRollback.rolledBack, true);
  assert.strictEqual(postInstallRollback.restoredPrevious, true);
  assert.strictEqual(postInstallRollback.sha256, oldSha);
  assert.strictEqual((await fs.readFile(path.join(root, 'app', 'LLera.exe'))).toString(), 'old-verified-payload');
  const rollbackJournal = JSON.parse(await fs.readFile(path.join(root, 'install-journal.json'), 'utf8'));
  assert.strictEqual(rollbackJournal.state, 'rolled-back-post-install-stability-failure');
  assert.strictEqual(rollbackJournal.rejectedSha256, newSha);
  assert.strictEqual(rollbackJournal.previousSha256, oldSha);

  healthy = false;
  let rolledBack = false;
  try {
    await lifecycle.install({
      payloadPath: newPayload,
      expectedSha256: newSha,
      version: '5.4.0-reconstructed-selftest-fail',
      selfTestTimeoutMs: 20,
    });
  } catch (error) {
    rolledBack = /rollback completed/.test(error.message);
  }
  assert.strictEqual(rolledBack, true);
  assert.strictEqual((await fs.readFile(path.join(root, 'app', 'LLera.exe'))).toString(), 'old-verified-payload');

  let clock = 100000;
  const watchdog = new CrashLoopWatchdog({
    stateFile: path.join(root, 'watchdog-state.json'),
    windowMs: 60000,
    maxCrashes: 3,
    cooldownMs: 300000,
    now: () => clock,
  });
  assert.strictEqual((await watchdog.recordExit({ code: 1 })).action, 'restart');
  clock += 1000;
  assert.strictEqual((await watchdog.recordExit({ code: 1 })).action, 'restart');
  clock += 1000;
  assert.strictEqual((await watchdog.recordExit({ code: 1 })).action, 'safe-mode');

  const profile = await watchdog.launchProfile();
  assert.strictEqual(profile.mode, 'safe');
  assert.strictEqual(profile.disableVision, true);
  assert.strictEqual(profile.disableBackgroundMissions, true);
  assert.strictEqual(profile.disableAutoModelLoad, true);
  assert.strictEqual(profile.inferenceConcurrency, 1);

  await watchdog.markStable();
  assert.strictEqual((await watchdog.launchProfile()).mode, 'normal');

  await lifecycle.uninstall({ keepUserData: true });
  console.log('windows packaging + watchdog parity PASS', {
    rollback: true,
    verifiedPostInstallRollback: true,
    crashLoopSafeMode: true,
    keepUserDataUninstall: true,
  });
})().catch(error => {
  console.error(error);
  process.exit(1);
});
