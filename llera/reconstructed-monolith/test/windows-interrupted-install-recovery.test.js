'use strict';

const assert = require('assert');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WindowsInstallLifecycle, sha256File } = require('../src/windows-packaging-lifecycle');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'llera-interrupted-install-'));
  const appDir = path.join(root, 'app');
  const rollbackDir = path.join(root, 'rollback');
  const stagingDir = path.join(root, 'staging');
  await Promise.all([
    fs.mkdir(appDir, {recursive:true}),
    fs.mkdir(rollbackDir, {recursive:true}),
    fs.mkdir(stagingDir, {recursive:true})
  ]);

  const oldBytes = Buffer.from('known-good-old');
  const newBytes = Buffer.from('new-but-unverified');
  const current = path.join(appDir, 'LLera.exe');
  const backup = path.join(rollbackDir, 'LLera.previous.exe');

  await fs.writeFile(current, newBytes);
  await fs.writeFile(backup, oldBytes);
  await fs.writeFile(`${current}.new`, Buffer.from('stale-temp'));
  await fs.writeFile(path.join(root, 'install-journal.json'), JSON.stringify({
    state:'activated-pending-self-test',
    version:'5.4.0-reconstructed',
    hadCurrent:true,
    sha256:sha(newBytes),
    previousSha256:sha(oldBytes)
  }, null, 2));

  let stopCalls = 0;
  const lifecycle = new WindowsInstallLifecycle({
    rootDir:root,
    stopApp:async()=>{stopCalls += 1;},
    now:()=>Date.parse('2026-08-28T03:50:00+03:00')
  });

  const recovered = await lifecycle.recoverInterruptedInstall();
  assert.strictEqual(recovered.recovered, true);
  assert.strictEqual(recovered.action, 'rollback');
  assert.strictEqual(recovered.restoredPrevious, true);
  assert.strictEqual(stopCalls, 1);
  assert.strictEqual((await fs.readFile(current)).toString(), oldBytes.toString());
  assert.strictEqual(await sha256File(current), sha(oldBytes));
  await assert.rejects(fs.access(`${current}.new`));

  const journal = JSON.parse(await fs.readFile(path.join(root, 'install-journal.json'), 'utf8'));
  assert.strictEqual(journal.state, 'rolled-back-interrupted-install');

  await fs.writeFile(current, newBytes);
  await fs.writeFile(backup, Buffer.from('tampered-old'));
  await fs.writeFile(path.join(root, 'install-journal.json'), JSON.stringify({
    state:'activated-pending-self-test',
    version:'5.4.0-reconstructed',
    hadCurrent:true,
    previousSha256:sha(oldBytes)
  }, null, 2));
  await assert.rejects(lifecycle.recoverInterruptedInstall(), /rollback backup integrity mismatch/);

  await fs.writeFile(path.join(root, 'install-journal.json'), '{broken');
  await assert.rejects(lifecycle.recoverInterruptedInstall(), /journal corrupt/);

  await fs.writeFile(current, oldBytes);
  await fs.writeFile(path.join(root, 'install-journal.json'), JSON.stringify({
    state:'staged',
    version:'next'
  }, null, 2));
  const staged = await lifecycle.recoverInterruptedInstall();
  assert.strictEqual(staged.action, 'discard-staged');
  assert.strictEqual(staged.preservedCurrent, true);
  assert.strictEqual((await fs.readFile(current)).toString(), oldBytes.toString());

  console.log('Windows interrupted-install recovery PASS', {
    crashRollback:true,
    backupIntegrityGate:true,
    corruptJournalFailClosed:true,
    stagedInstallPreservesCurrent:true
  });
})().catch(error => {
  console.error(error);
  process.exit(1);
});
