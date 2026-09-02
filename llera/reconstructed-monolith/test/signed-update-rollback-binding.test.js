'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { SignedUpdateLifecycle, stableStringify } = require('../src/signed-update-lifecycle');

(async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'llera-updater-rollback-binding-'));
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const lifecycle = new SignedUpdateLifecycle({ rootDir: tmp, publicKey });
  await lifecycle.init();

  await fs.mkdir(lifecycle.paths.current, { recursive: true });
  await fs.mkdir(lifecycle.paths.staging, { recursive: true });
  const current = path.join(lifecycle.paths.current, 'LLera.bin');
  const staged = path.join(lifecycle.paths.staging, 'candidate.bin');
  const oldBytes = Buffer.from('previous verified LLera');
  const newBytes = Buffer.from('new signed LLera');
  await fs.writeFile(current, oldBytes);
  await fs.writeFile(staged, newBytes);

  const manifest = {
    version:'5.4-reconstructed',
    artifact:{
      url:'https://updates.invalid/LLera.bin',
      size:newBytes.length,
      sha256:crypto.createHash('sha256').update(newBytes).digest('hex')
    }
  };
  const signatureBase64 = crypto.sign(null, Buffer.from(stableStringify(manifest)), privateKey).toString('base64');
  const verificationReceipt = lifecycle.verifySignedManifest(manifest, signatureBase64);

  const activated = await lifecycle.activateStaged(manifest, staged, { verificationReceipt });
  assert.equal(activated.backupAvailable, true);
  const journal = await lifecycle.readJournal();
  assert.equal(journal.backupSha256, crypto.createHash('sha256').update(oldBytes).digest('hex'));
  assert.equal(journal.manifestPayloadSha256, verificationReceipt.payloadSha256);

  const outside = path.join(tmp, '..', `llera-outside-${crypto.randomUUID()}.bin`);
  const outsideBackup = path.join(tmp, '..', `llera-outside-backup-${crypto.randomUUID()}.bin`);
  await fs.writeFile(outside, Buffer.from('outside target must never change'));
  await fs.writeFile(outsideBackup, oldBytes);
  const forgedPathJournal = {
    ...journal,
    currentFile: outside,
    backupFile: outsideBackup,
    backupSha256: crypto.createHash('sha256').update(oldBytes).digest('hex')
  };
  await lifecycle._writeJournal(forgedPathJournal);
  await assert.rejects(lifecycle.rollback(), /rollback journal path binding mismatch/);
  assert.equal((await fs.readFile(outside)).toString(), 'outside target must never change', 'forged journal must not redirect rollback outside managed current path');
  assert.equal((await fs.readFile(current)).toString(), newBytes.toString(), 'active build must remain unchanged after forged path rejection');

  await lifecycle._writeJournal(journal);
  await fs.writeFile(journal.backupFile, Buffer.from('tampered rollback bytes'));
  await assert.rejects(lifecycle.rollback(), /rollback backup integrity mismatch/);
  assert.equal((await fs.readFile(current)).toString(), newBytes.toString(), 'active verified build must remain untouched after rejected rollback');

  const legacyJournal = { ...journal };
  delete legacyJournal.backupSha256;
  await lifecycle._writeJournal(legacyJournal);
  await assert.rejects(lifecycle.rollback(), /rollback backup digest unavailable/);

  console.log('MONOLITH signed updater rollback binding PASS', {
    signedManifestReceiptRequired:true,
    backupDigestJournalBound:true,
    manifestDigestJournalBound:true,
    rollbackPathsRootBound:true,
    forgedExternalTargetRejected:true,
    tamperedBackupRejected:true,
    activeBuildPreservedOnReject:true,
    unboundLegacyRollbackFailsClosed:true
  });
})().catch(err => { console.error(err); process.exit(1); });
