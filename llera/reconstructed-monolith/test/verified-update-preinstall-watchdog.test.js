'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { VerifiedUpdateInstallCoordinator } = require('../src/verified-update-install-coordinator');

(async () => {
  const artifactSha256 = crypto.createHash('sha256').update('payload').digest('hex');
  const payloadManifestSha256 = crypto.createHash('sha256').update('manifest').digest('hex');
  const manifest = {
    version: '5.4.0-reconstructed.1',
    artifact: {
      sha256: artifactSha256,
      size: 7,
      url: 'https://example.invalid/LLera.exe'
    }
  };
  const receipt = Object.freeze({
    verified: true,
    receiptId: 'receipt-preinstall-watchdog',
    payloadSha256: payloadManifestSha256,
    version: manifest.version,
    artifactSha256,
    artifactSize: 7,
    artifactUrl: manifest.artifact.url
  });

  const calls = [];
  const updater = {
    verifySignedManifest() {
      calls.push('verify');
      return receipt;
    },
    async downloadArtifact(_manifest, { verificationReceipt }) {
      assert.strictEqual(verificationReceipt, receipt);
      calls.push('download');
      return { path: '/tmp/download.bin', sha256: artifactSha256, size: 7 };
    },
    async stageArtifact(_manifest, downloadedPath, { verificationReceipt }) {
      assert.strictEqual(verificationReceipt, receipt);
      assert.strictEqual(downloadedPath, '/tmp/download.bin');
      calls.push('stage');
      return '/tmp/staged.exe';
    }
  };

  let launchProfileCalls = 0;
  const watchdog = {
    async launchProfile() {
      launchProfileCalls += 1;
      return launchProfileCalls === 1 ? { mode: 'normal' } : { mode: 'safe' };
    },
    async markStable() {
      throw new Error('markStable must not run when safe mode engages before install');
    }
  };

  let installCalls = 0;
  const installer = {
    async install() {
      installCalls += 1;
      throw new Error('installer must not run after watchdog transitions to safe mode');
    }
  };

  const coordinator = new VerifiedUpdateInstallCoordinator({
    updater,
    installer,
    watchdog,
    now: () => '2026-09-04T01:55:00+03:00'
  });

  const result = await coordinator.apply({
    manifest,
    signatureBase64: 'signed-manifest'
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.blocked, true);
  assert.strictEqual(result.reason, 'watchdog_safe_mode_before_install');
  assert.strictEqual(result.phase, 'pre-install');
  assert.strictEqual(result.artifactSha256, artifactSha256);
  assert.strictEqual(result.manifestPayloadSha256, payloadManifestSha256);
  assert.strictEqual(launchProfileCalls, 2);
  assert.strictEqual(installCalls, 0);
  assert.deepStrictEqual(calls, ['verify', 'download', 'stage']);

  console.log('Verified update pre-install watchdog re-observation regression PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
