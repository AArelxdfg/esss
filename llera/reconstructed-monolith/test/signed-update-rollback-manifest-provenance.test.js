'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { SignedUpdateLifecycle, stableStringify } = require('../src/signed-update-lifecycle');

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

(async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'llera-updater-provenance-'));
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const lifecycle = new SignedUpdateLifecycle({ rootDir: tmp, publicKey });
  await lifecycle.init();
  await fs.mkdir(lifecycle.paths.current, { recursive: true });

  const current = path.join(lifecycle.paths.current, 'LLera.bin');
  const backup = path.join(lifecycle.paths.backup, 'LLera.previous.bin');
  const activeBytes = Buffer.from('signed active build');
  const previousBytes = Buffer.from('previous verified build');
  const attackerBytes = Buffer.from('attacker substituted rollback payload');
  const manifest = {
    version: '5.4-reconstructed',
    artifact: {
      url: 'https://updates.example.invalid/LLera.bin',
      size: activeBytes.length,
      sha256: sha256(activeBytes)
    }
  };
  const payload = Buffer.from(stableStringify(manifest));
  const signature = crypto.sign(null, payload, privateKey);
  const signatureBase64 = signature.toString('base64');

  const makeJournal = (overrides = {}) => ({
    state: 'activated',
    version: manifest.version,
    currentFile: current,
    backupFile: backup,
    backupSha256: sha256(previousBytes),
    sha256: manifest.artifact.sha256,
    manifestPayloadSha256: sha256(payload),
    manifestSignatureSha256: sha256(signature),
    signedManifest: manifest,
    manifestSignatureBase64: signatureBase64,
    ...overrides
  });

  await fs.writeFile(current, activeBytes);
  await fs.writeFile(backup, previousBytes);

  await lifecycle._writeJournal(makeJournal({ signedManifest: { ...manifest, version: '5.4-forged' } }));
  await assert.rejects(lifecycle.rollback(), /version binding mismatch|payload binding mismatch|signature invalid/);
  assert.deepEqual(await fs.readFile(current), activeBytes, 'forged manifest must not change active artifact');

  await lifecycle._writeJournal(makeJournal({ manifestSignatureBase64: Buffer.alloc(64, 7).toString('base64') }));
  await assert.rejects(lifecycle.rollback(), /signature binding mismatch|signature invalid/);
  assert.deepEqual(await fs.readFile(current), activeBytes, 'forged signature must not change active artifact');

  await fs.writeFile(backup, attackerBytes);
  await lifecycle._writeJournal(makeJournal({ backupSha256: sha256(attackerBytes) }));
  await assert.rejects(lifecycle.rollback(), /backup integrity mismatch|signed manifest provenance|manifest/);
  assert.deepEqual(await fs.readFile(current), activeBytes, 'journal and backup substitution must not replace active artifact');

  await fs.writeFile(backup, previousBytes);
  await lifecycle._writeJournal(makeJournal());
  const result = await lifecycle.rollback();
  assert.equal(result.restoredSha256, sha256(previousBytes));
  assert.deepEqual(await fs.readFile(current), previousBytes, 'valid signed provenance must preserve legitimate rollback');

  console.log('MONOLITH signed updater rollback manifest provenance PASS', {
    forgedManifestRejected: true,
    forgedSignatureRejected: true,
    journalBackupSubstitutionRejected: true,
    legitimateRollbackPreserved: true
  });
})().catch(err => { console.error(err); process.exit(1); });
