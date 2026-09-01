'use strict';

const assert = require('assert');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WindowsInstallLifecycle } = require('../src/windows-packaging-lifecycle');

const sha = v => crypto.createHash('sha256').update(v).digest('hex');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'llera-repair-guard-'));
  const app = path.join(root, 'app');
  const rollback = path.join(root, 'rollback');
  await fs.mkdir(app, {recursive:true});
  await fs.mkdir(rollback, {recursive:true});

  const oldBytes = Buffer.from('known-good-old');
  const newBytes = Buffer.from('unverified-new');
  const current = path.join(app, 'LLera.exe');
  const journal = path.join(root, 'install-journal.json');

  await fs.writeFile(current, newBytes);
  await fs.writeFile(journal, JSON.stringify({
    state:'activated-pending-self-test',
    version:'5.4.0-reconstructed',
    hadCurrent:true,
    sha256:sha(newBytes),
    previousSha256:sha(oldBytes)
  }));

  const lifecycle = new WindowsInstallLifecycle({
    rootDir: root,
    stopApp: async()=>{},
    now: ()=>Date.parse('2026-08-28T06:48:01+03:00')
  });

  const recovered = await lifecycle.recoverInterruptedInstall();
  assert.strictEqual(recovered.recovered, false);
  assert.strictEqual(recovered.blocked, true);
  assert.strictEqual(recovered.repairRequired, true);
  assert.strictEqual(recovered.reason, 'rollback-backup-missing:interrupted-self-test');
  assert.strictEqual((await fs.readFile(current)).toString(), newBytes.toString());
  assert.ok(recovered.quarantinedCurrent);
  assert.strictEqual((await fs.readFile(recovered.quarantinedCurrent.path)).toString(), newBytes.toString());
  assert.strictEqual(recovered.quarantinedCurrent.sha256, sha(newBytes));

  const repairJournal = JSON.parse(await fs.readFile(journal, 'utf8'));
  assert.strictEqual(repairJournal.state, 'repair-required-missing-rollback');

  const payload = path.join(root, 'payload.exe');
  await fs.writeFile(payload, Buffer.from('next'));
  await assert.rejects(
    lifecycle.install({
      payloadPath: payload,
      expectedSha256: sha(Buffer.from('next')),
      version: 'next'
    }),
    /install blocked: repair required/
  );

  const root2 = await fs.mkdtemp(path.join(os.tmpdir(), 'llera-repair-ok-'));
  await fs.mkdir(path.join(root2,'app'), {recursive:true});
  await fs.mkdir(path.join(root2,'rollback'), {recursive:true});
  await fs.writeFile(path.join(root2,'app','LLera.exe'), newBytes);
  await fs.writeFile(path.join(root2,'rollback','LLera.previous.exe'), oldBytes);
  await fs.writeFile(path.join(root2,'install-journal.json'), JSON.stringify({
    state:'activated-pending-self-test',
    version:'5.4.0-reconstructed',
    hadCurrent:true,
    sha256:sha(newBytes),
    previousSha256:sha(oldBytes)
  }));

  const okLifecycle = new WindowsInstallLifecycle({rootDir:root2, stopApp:async()=>{}});
  const ok = await okLifecycle.recoverInterruptedInstall();
  assert.strictEqual(ok.recovered, true);
  assert.strictEqual(ok.action, 'rollback');
  assert.strictEqual(
    (await fs.readFile(path.join(root2,'app','LLera.exe'))).toString(),
    oldBytes.toString()
  );

  console.log('Windows rollback repair guard PASS', {
    missingBackupFailClosed:true,
    unverifiedCandidateQuarantined:true,
    repairStateInterlock:true,
    normalRollbackPreserved:true
  });
})().catch(err => {
  console.error(err);
  process.exit(1);
});
