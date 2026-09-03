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

  const empty = sentinel.verifyTree({ files: [] });
  assert.strictEqual(empty.ok, false);
  assert.strictEqual(empty.manifestValid, false);
  assert.strictEqual(empty.checked, 0);
  assert.ok(empty.failures.some((failure) => failure.reason === 'manifest-files-empty'));

  const emptyTrusted = sentinel.assertTrusted({ files: [] });
  assert.strictEqual(emptyTrusted.trusted, false);
  assert.strictEqual(emptyTrusted.signature, null);
  assert.ok(emptyTrusted.tree.failures.some((failure) => failure.reason === 'manifest-files-empty'));

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

  const coercedSize = sentinel.verifyTree({ files: [{ ...validEntry, size: String(bytes.length) }] });
  assert.strictEqual(coercedSize.ok, false);
  assert.strictEqual(coercedSize.manifestValid, false);
  assert.ok(coercedSize.failures.some((failure) => failure.reason === 'invalid-size'));

  const coercibleSha = {
    toString() {
      return validEntry.sha256;
    },
  };
  const coercedSha = sentinel.verifyTree({ files: [{ ...validEntry, sha256: coercibleSha }] });
  assert.strictEqual(coercedSha.ok, false);
  assert.strictEqual(coercedSha.manifestValid, false);
  assert.ok(coercedSha.failures.some((failure) => failure.reason === 'invalid-sha256'));

  const arrayEntry = sentinel.verifyTree({ files: [[validEntry.path, validEntry.sha256, validEntry.size]] });
  assert.strictEqual(arrayEntry.ok, false);
  assert.strictEqual(arrayEntry.manifestValid, false);
  assert.ok(arrayEntry.failures.some((failure) => failure.reason === 'entry-object-required'));

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
    emptyManifestsRejected: true,
    duplicatePathsRejected: true,
    malformedHashesRejected: true,
    unsafeSizesRejected: true,
    typeCoercionRejected: true,
    arrayEntriesRejected: true,
    malformedEntriesFailClosed: true,
  });
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
