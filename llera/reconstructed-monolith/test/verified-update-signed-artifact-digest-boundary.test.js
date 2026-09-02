'use strict';
const assert = require('assert');
const { VerifiedUpdateInstallCoordinator } = require('../src/verified-update-install-coordinator');

function make(sha256) {
  const calls = { verify: 0, watchdog: 0, download: 0, stage: 0, install: 0, stable: 0 };
  const normalized = 'a'.repeat(64);
  const updater = {
    verifySignedManifest() { calls.verify += 1; return { verified: true, payloadSha256: 'b'.repeat(64) }; },
    async downloadArtifact() { calls.download += 1; return { path: 'download.bin', sha256: normalized }; },
    async stageArtifact() { calls.stage += 1; return 'staged.bin'; }
  };
  const installer = {
    async install() { calls.install += 1; return { verified: true, sha256: normalized, current: 'current/LLera.bin' }; }
  };
  const watchdog = {
    async launchProfile() { calls.watchdog += 1; return { mode: 'normal' }; },
    async markStable() { calls.stable += 1; }
  };
  return {
    coordinator: new VerifiedUpdateInstallCoordinator({ updater, installer, watchdog }),
    calls,
    manifest: { version: 'digest-boundary', artifact: { sha256 } }
  };
}

(async () => {
  for (const bad of [undefined, null, '', 'abc', 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]) {
    const { coordinator, calls, manifest } = make(bad);
    if (bad === undefined) delete manifest.artifact.sha256;
    const result = await coordinator.apply({ manifest, signatureBase64: 'signed' });
    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.equal(result.reason, 'signed_manifest_artifact_sha256_invalid');
    assert.deepEqual(calls, { verify: 1, watchdog: 0, download: 0, stage: 0, install: 0, stable: 0 });
  }

  {
    const { coordinator, calls, manifest } = make('A'.repeat(64));
    const result = await coordinator.apply({ manifest, signatureBase64: 'signed' });
    assert.equal(result.ok, true);
    assert.equal(result.artifactSha256, 'a'.repeat(64));
    assert.deepEqual(calls, { verify: 1, watchdog: 1, download: 1, stage: 1, install: 1, stable: 1 });
  }

  console.log('verified update signed artifact digest boundary PASS');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
