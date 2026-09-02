'use strict';
const assert = require('assert');
const { VerifiedUpdateInstallCoordinator } = require('../src/verified-update-install-coordinator');

function harness(receipt) {
  const calls = { verify: 0, watchdog: 0, download: 0, stage: 0, install: 0, stable: 0 };
  const updater = {
    verifySignedManifest() { calls.verify += 1; return receipt; },
    async downloadArtifact() { calls.download += 1; return { path: 'download.bin', sha256: 'a'.repeat(64) }; },
    async stageArtifact() { calls.stage += 1; return 'staged.bin'; }
  };
  const installer = { async install() { calls.install += 1; return { verified: true, sha256: 'a'.repeat(64) }; } };
  const watchdog = {
    async launchProfile() { calls.watchdog += 1; return { mode: 'normal' }; },
    async markStable() { calls.stable += 1; }
  };
  return {
    coordinator: new VerifiedUpdateInstallCoordinator({ updater, installer, watchdog }),
    calls,
    manifest: { version: 'receipt-boundary', artifact: { sha256: 'a'.repeat(64) } }
  };
}

(async () => {
  for (const payloadSha256 of [undefined, '', 'abc', 'g'.repeat(64), 'b'.repeat(63), 'b'.repeat(65)]) {
    const receipt = { verified: true, payloadSha256, artifactSha256: 'a'.repeat(64) };
    if (payloadSha256 === undefined) delete receipt.payloadSha256;
    const { coordinator, calls, manifest } = harness(receipt);
    const result = await coordinator.apply({ manifest, signatureBase64: 'signed' });
    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.equal(result.reason, 'signed_manifest_receipt_invalid');
    assert.deepEqual(calls, { verify: 1, watchdog: 0, download: 0, stage: 0, install: 0, stable: 0 });
  }

  for (const artifactSha256 of [undefined, '', 'abc', 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]) {
    const receipt = { verified: true, payloadSha256: 'b'.repeat(64), artifactSha256 };
    if (artifactSha256 === undefined) delete receipt.artifactSha256;
    const { coordinator, calls, manifest } = harness(receipt);
    const result = await coordinator.apply({ manifest, signatureBase64: 'signed' });
    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.equal(result.reason, 'signed_manifest_receipt_artifact_invalid');
    assert.deepEqual(calls, { verify: 1, watchdog: 0, download: 0, stage: 0, install: 0, stable: 0 });
  }

  {
    const { coordinator, calls, manifest } = harness({
      verified: true,
      payloadSha256: 'b'.repeat(64),
      artifactSha256: 'c'.repeat(64)
    });
    const result = await coordinator.apply({ manifest, signatureBase64: 'signed' });
    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.equal(result.reason, 'signed_manifest_receipt_artifact_mismatch');
    assert.deepEqual(calls, { verify: 1, watchdog: 0, download: 0, stage: 0, install: 0, stable: 0 });
  }

  {
    const { coordinator, calls, manifest } = harness({
      verified: true,
      payloadSha256: 'B'.repeat(64),
      artifactSha256: 'A'.repeat(64)
    });
    const result = await coordinator.apply({ manifest, signatureBase64: 'signed' });
    assert.equal(result.ok, true);
    assert.equal(result.manifestPayloadSha256, 'b'.repeat(64));
    assert.equal(result.artifactSha256, 'a'.repeat(64));
    assert.deepEqual(calls, { verify: 1, watchdog: 1, download: 1, stage: 1, install: 1, stable: 1 });
  }

  console.log('verified update receipt binding boundary PASS');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
