'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { SignedUpdateLifecycle, stableStringify } = require('../src/signed-update-lifecycle');

(async () => {
  const rootA = await fs.mkdtemp(path.join(os.tmpdir(), 'llera-updater-receipt-a-'));
  const rootB = await fs.mkdtemp(path.join(os.tmpdir(), 'llera-updater-receipt-b-'));
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const artifact = Buffer.from('MONOLITH signed receipt instance binding');
  const manifest = {
    version: '5.4-cross-instance-receipt',
    artifact: {
      url: 'https://updates.invalid/LLera.bin',
      size: artifact.length,
      sha256: crypto.createHash('sha256').update(artifact).digest('hex')
    }
  };
  const signatureBase64 = crypto.sign(null, Buffer.from(stableStringify(manifest)), privateKey).toString('base64');
  let networkCalls = 0;
  const fetchImpl = async () => {
    networkCalls += 1;
    throw new Error('network must not be reached by replayed receipt');
  };

  const verifierInstance = new SignedUpdateLifecycle({ rootDir: rootA, publicKey, fetchImpl });
  const unrelatedInstance = new SignedUpdateLifecycle({ rootDir: rootB, publicKey, fetchImpl });
  const receipt = verifierInstance.verifySignedManifest(manifest, signatureBase64);

  await assert.rejects(
    () => unrelatedInstance.downloadArtifact(manifest, { resume: false, verificationReceipt: receipt }),
    /verification receipt mismatch/
  );
  assert.strictEqual(networkCalls, 0, 'cross-instance receipt replay must fail before network access');

  const ownReceipt = unrelatedInstance.verifySignedManifest(manifest, signatureBase64);
  assert.notStrictEqual(ownReceipt.receiptId, receipt.receiptId, 'verification receipts must be instance-local capabilities');

  console.log('signed updater cross-instance receipt replay boundary PASS', {
    replayRejectedBeforeNetwork: true,
    receiptCapabilityIsInstanceLocal: true
  });
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
