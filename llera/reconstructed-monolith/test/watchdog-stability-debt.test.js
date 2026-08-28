'use strict';

const assert = require('assert');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { CrashLoopWatchdog } = require('../src/windows-packaging-lifecycle');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'llera-watchdog-debt-'));
  const stateFile = path.join(root, 'watchdog-state.json');
  let clock = 500000;

  const watchdog = new CrashLoopWatchdog({
    stateFile,
    windowMs: 60000,
    maxCrashes: 3,
    cooldownMs: 300000,
    now: () => clock,
  });

  await watchdog.recordExit({ code: 1 });
  clock += 1000;
  await watchdog.recordExit({ code: 1 });
  clock += 1000;
  assert.strictEqual((await watchdog.recordExit({ code: 1 })).action, 'safe-mode');
  assert.strictEqual((await watchdog.launchProfile()).mode, 'safe');

  clock += 1000;
  assert.strictEqual((await watchdog.recordExit({ code: 0 })).action, 'none');
  assert.strictEqual((await watchdog.launchProfile()).mode, 'safe');

  clock += 1000;
  assert.strictEqual((await watchdog.recordExit({ code: 0, planned: true })).action, 'none');
  assert.strictEqual((await watchdog.launchProfile()).mode, 'safe');

  await watchdog.markStable();
  assert.strictEqual((await watchdog.launchProfile()).mode, 'normal');

  await fs.writeFile(stateFile, '{broken-json', 'utf8');
  const corruptProfile = await watchdog.launchProfile();
  assert.strictEqual(corruptProfile.mode, 'safe');
  assert.strictEqual(corruptProfile.reason, 'watchdog-state-corrupt');

  await watchdog.recordExit({ code: 0, planned: true });
  assert.strictEqual((await watchdog.launchProfile()).mode, 'safe');

  await watchdog.markStable();
  assert.strictEqual((await watchdog.launchProfile()).mode, 'normal');

  console.log('MONOLITH watchdog stability-debt gate PASS', {
    cleanExitCannotClearCrashDebt: true,
    plannedExitCannotClearCrashDebt: true,
    corruptStateFailsSafe: true,
    onlyMarkStableClearsDebt: true,
  });
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
