'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { IntegritySentinel, sha256Bytes, validateManifest } = require('../src/integrity-sentinel');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llera-integrity-manifest-'));
try {
  const bytes = Buffer.from('MONOLITH INTEGRITY TEST');
  fs.writeFileSync(path.join(root, 'artifact.bin'), bytes);
  const validEntry = { path: 'artifact.bin', sha256: sha256Bytes(bytes), size: bytes.length };

  const valid = validateManifest({ files: [validEntry] });
  assert.strictEqual(valid.ok, true);

  const sentinel = new IntegritySentinel({ rootDir: root });
  const validTree = sentinel.verifyTree({ files: [validEntry] });
  assert.strictEqual(validTree.ok, true);
  assert.strictEqual(validTree.manifestValid, true);
  assert.strictEqual(validTree.checked, 1);

  const duplicate = sentinel.verifyTree({ files: [validEntry, { ...validEntry }] });
  assert.strictEqual(duplicate.ok, false);
  assert.strictEqual(duplicate.manifestValid, false);
  assert.strictEqual(duplicate.checked, 0);
  assert.ok(duplicate.failures.some((failure) => failure.reason === 'duplicate-path'));

  const invalidSha = sentinel.verifyTree({ files: [{ ...validEntry, sha256: 'not-a-hash' }] });
  assert.strictEqual(invalidSha.ok, false);
  assert.ok(invalidSha.failures.some((failure) => failure.reason === 'invalid-sha256'));

  const invalidSize = sentinel.verifyTree({ files: [{ ...validEntry, size: -1 }] });
  assert.strictEqual(invalidSize.ok, false);
  assert.ok(invalidSize.failures.some((failure) => failure.reason === 'invalid-size'));

  const malformed = sentinel.verifyTree({ files: [null] });
  assert.strictEqual(malformed.ok, false);
  assert.strictEqual(malformed.manifestValid, false);
  assert.ok(malformed.failures.some((failure) => failure.reason === 'entry-object-required'));

  const missingFiles = sentinel.verifyTree({});
  assert.strictEqual(missingFiles.ok, false);
  assert.ok(missingFiles.failures.some((failure) => failure.reason === 'manifest-files-required'));

  const trustedMalformed = sentinel.assertTrusted({ files: [{ ...validEntry, size: Number.MAX_SAFE_INTEGER + 1 }] });
  assert.strictEqual(trustedMalformed.trusted, false);
  assert.strictEqual(trustedMalformed.signature, null);

  console.log('MONOLITH integrity sentinel manifest validation PASS', {
    validManifestAccepted: true,
    duplicatePathsRejected: true,
    malformedHashesRejected: true,
    unsafeSizesRejected: true,
    malformedEntriesFailClosed: true,
  });
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
