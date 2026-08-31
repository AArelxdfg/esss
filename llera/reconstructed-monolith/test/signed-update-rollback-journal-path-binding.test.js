'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { SignedUpdateLifecycle } = require('../src/signed-update-lifecycle');

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

(async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'llera-updater-journal-path-'));
  const external = await fs.mkdtemp(path.join(os.tmpdir(), 'llera-updater-external-'));
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  const lifecycle = new SignedUpdateLifecycle({ rootDir: tmp, publicKey });
  await lifecycle.init();
  await fs.mkdir(lifecycle.paths.current, { recursive: true });

  const current = path.join(lifecycle.paths.current, 'LLera.bin');
  const backup = path.join(lifecycle.paths.backup, 'LLera.previous.bin');
  const externalCurrent = path.join(external, 'victim.bin');
  const externalBackup = path.join(external, 'attacker-backup.bin');
  const activeBytes = Buffer.from('active signed candidate');
  const previousBytes = Buffer.from('previous verified candidate');
  const victimBytes = Buffer.from('do not overwrite me');

  await fs.writeFile(current, activeBytes);
  await fs.writeFile(backup, previousBytes);
  await fs.writeFile(externalCurrent, victimBytes);
  await fs.writeFile(externalBackup, previousBytes);

  const baseJournal = {
    state: 'activated',
    version: '5.4-reconstructed',
    currentFile: current,
    backupFile: backup,
    backupSha256: sha256(previousBytes),
    manifestPayloadSha256: 'a'.repeat(64),
    manifestSignatureSha256: 'b'.repeat(64)
  };

  await lifecycle._writeJournal({ ...baseJournal, currentFile: externalCurrent });
  await assert.rejects(lifecycle.rollback(), /rollback current path binding mismatch/);
  assert.deepEqual(await fs.readFile(externalCurrent), victimBytes, 'tampered journal must not redirect rollback write target');

  await lifecycle._writeJournal({ ...baseJournal, backupFile: externalBackup });
  await assert.rejects(lifecycle.rollback(), /rollback backup path binding mismatch/);
  assert.deepEqual(await fs.readFile(current), activeBytes, 'tampered journal must not substitute an external backup path');

  await lifecycle._writeJournal(baseJournal);
  const result = await lifecycle.rollback();
  assert.equal(result.restoredSha256, sha256(previousBytes));
  assert.deepEqual(await fs.readFile(current), previousBytes, 'canonical bound rollback must still succeed');

  console.log('MONOLITH signed updater rollback journal path binding PASS', {
    redirectedCurrentRejected: true,
    substitutedBackupRejected: true,
    canonicalRollbackPreserved: true
  });
})().catch(err => { console.error(err); process.exit(1); });
