'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_MANIFEST_FILES,
  canonicalManifestPayload,
  validateManifest,
} = require('../src/integrity-sentinel');

test('Integrity Sentinel rejects oversized manifests before entry traversal', () => {
  let touched = 0;
  const files = Array.from({ length: MAX_MANIFEST_FILES + 1 }, () => ({
    get path() {
      touched += 1;
      return 'should-not-be-read';
    },
    sha256: '0'.repeat(64),
    size: 0,
  }));

  const result = validateManifest({ schema: 1, product: 'LLera', version: '5.4.0', files });
  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, [{
    reason: 'manifest-files-limit',
    limit: MAX_MANIFEST_FILES,
    actual: MAX_MANIFEST_FILES + 1,
  }]);
  assert.equal(touched, 0, 'oversized manifest must fail before inspecting attacker-controlled entries');
});

test('canonical manifest generation fails closed on oversized manifests', () => {
  const files = Array(MAX_MANIFEST_FILES + 1).fill(null);
  assert.throws(
    () => canonicalManifestPayload({ files }),
    (error) => error && error.code === 'INTEGRITY_MANIFEST_INVALID' &&
      error.failures.some((failure) => failure.reason === 'manifest-files-limit'),
  );
});
