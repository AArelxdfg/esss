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

  const makeProvenance = (version, bytes) => {
    const manifest = {
      version,
      artifact: { url: `https://updates.example.invalid/${version}.bin`, size: bytes.length, sha256: sha256(bytes) }
    };
    const payload = Buffer.from(stableStringify(manifest));
    const signature = crypto.sign(null, payload, privateKey);
    return {
      manifest,
      manifestPayloadSha256: sha256(payload),
      manifestSignatureSha256: sha256(signature),
      manifestSignatureBase64: signature.toString('base64')
    };
  };

  const activeProvenance = makeProvenance('5.4-reconstructed', activeBytes);
  const backupProvenance = makeProvenance('5.3.5-reconstructed', previousBytes);
  const makeJournal = (overrides = {}) => ({
    state: 'activated',
    version: activeProvenance.manifest.version,
    currentFile: current,
    backupFile: backup,
    backupSha256: sha256(previousBytes),
    backupProvenance,
    sha256: sha256(activeBytes),
    activeProvenance,
    ...overrides
  });

  await fs.writeFile(current, activeBytes);
  await fs.writeFile(backup, previousBytes);

  const forgedActive = JSON.parse(JSON.stringify(activeProvenance));
  forgedActive.manifest.version = '5.4-forged';
  await lifecycle._writeJournal(makeJournal({ activeProvenance: forgedActive }));
  await assert.rejects(lifecycle.rollback(), /active provenance (payload binding mismatch|signature invalid)/);
  assert.deepEqual(await fs.readFile(current), activeBytes, 'forged active manifest must not change active artifact');

  const forgedBackupSignature = { ...backupProvenance, manifestSignatureBase64: Buffer.alloc(64, 7).toString('base64') };
  await lifecycle._writeJournal(makeJournal({ backupProvenance: forgedBackupSignature }));
  await assert.rejects(lifecycle.rollback(), /backup provenance (signature binding mismatch|signature invalid)/);
  assert.deepEqual(await fs.readFile(current), activeBytes, 'forged backup signature must not change active artifact');

  await fs.writeFile(backup, attackerBytes);
  await lifecycle._writeJournal(makeJournal({ backupSha256: sha256(attackerBytes) }));
  await assert.rejects(lifecycle.rollback(), /backup provenance artifact binding mismatch/);
  assert.deepEqual(await fs.readFile(current), activeBytes, 'journal and backup substitution must not replace active artifact');

  await fs.writeFile(backup, previousBytes);
  await lifecycle._writeJournal(makeJournal());
  const result = await lifecycle.rollback();
  assert.equal(result.restoredSha256, sha256(previousBytes));
  assert.deepEqual(await fs.readFile(current), previousBytes, 'valid signed active+backup provenance must preserve legitimate rollback');

  const restoredProvenance = JSON.parse(await fs.readFile(lifecycle.paths.currentProvenance, 'utf8'));
  assert.deepEqual(restoredProvenance, backupProvenance, 'rollback must restore the previous signed provenance sidecar with the bytes');

  console.log('MONOLITH signed updater rollback manifest provenance PASS', {
    forgedActiveManifestRejected: true,
    forgedBackupSignatureRejected: true,
    journalBackupSubstitutionRejected: true,
    legitimateRollbackPreserved: true,
    provenanceSidecarRestored: true
  });
})().catch(err => { console.error(err); process.exit(1); });
