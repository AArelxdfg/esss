'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { SignedUpdateLifecycle, stableStringify } = require('../src/signed-update-lifecycle');

(async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'llera-updater-binding-'));
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const bytes = Buffer.from('LLera signed manifest binding payload');
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const manifest = {
    product: 'LLera MONOLITH OMEGA',
    version: 'restore-binding-0.1.0',
    artifact: { url: 'https://updates.invalid/llera.bin', size: bytes.length, sha256: digest }
  };
  const signature = crypto.sign(null, Buffer.from(stableStringify(manifest)), privateKey).toString('base64');
  let fetchCount = 0;
  const fetchImpl = async () => {
    fetchCount += 1;
    return { ok: true, status: 200, headers: { get: () => null }, body: Readable.from([bytes]) };
  };

  const lifecycle = new SignedUpdateLifecycle({ rootDir: tmp, publicKey, fetchImpl });

  await assert.rejects(
    lifecycle.downloadArtifact(manifest),
    /manifest not verified for update lifecycle/
  );
  assert.equal(fetchCount, 0, 'unverified manifest must be rejected before network I/O');

  const verified = lifecycle.verifySignedManifest(manifest, signature);
  assert.equal(verified.verified, true);
  assert.match(verified.payloadSha256, /^[a-f0-9]{64}$/);
  assert.match(verified.signatureSha256, /^[a-f0-9]{64}$/);

  const mutated = JSON.parse(JSON.stringify(manifest));
  mutated.artifact.url = 'https://updates.invalid/tampered.bin';
  await assert.rejects(
    lifecycle.downloadArtifact(mutated),
    /manifest not verified for update lifecycle/
  );
  assert.equal(fetchCount, 0, 'post-verification mutation must not reach network I/O');

  const exactClone = JSON.parse(JSON.stringify(manifest));
  const downloaded = await lifecycle.downloadArtifact(exactClone, { resume: false });
  assert.equal(fetchCount, 1);
  assert.equal(downloaded.sha256, digest);

  const unsignedStageManifest = JSON.parse(JSON.stringify(manifest));
  unsignedStageManifest.version = 'restore-binding-0.1.1';
  await assert.rejects(
    lifecycle.stageArtifact(unsignedStageManifest, downloaded.path),
    /manifest not verified for update lifecycle/
  );

  const staged = await lifecycle.stageArtifact(exactClone, downloaded.path);
  await fs.mkdir(lifecycle.paths.current, { recursive: true });
  await fs.writeFile(path.join(lifecycle.paths.current, 'LLera.bin'), Buffer.from('old LLera build'));
  await lifecycle.activateStaged(exactClone, staged);

  const journal = await lifecycle.readJournal();
  assert.equal(journal.manifestPayloadSha256, verified.payloadSha256);
  assert.equal(journal.manifestSignatureSha256, verified.signatureSha256);

  console.log('MONOLITH signed update manifest binding PASS', {
    unsignedBlockedBeforeNetwork: true,
    postVerificationMutationBlocked: true,
    exactSignedCloneAccepted: true,
    provenanceJournalBound: true
  });
})().catch(err => { console.error(err); process.exit(1); });
