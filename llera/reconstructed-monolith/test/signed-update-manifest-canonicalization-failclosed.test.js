'use strict';

const assert = require('assert');
const { stableStringify } = require('../src/signed-update-lifecycle');

(() => {
  const canonicalA = stableStringify({
    version: '5.4.0',
    artifact: { url: 'https://example.invalid/llera.bin', size: 42, sha256: 'a'.repeat(64) },
    metadata: { channel: 'stable', retry: 0, enabled: true, nullable: null }
  });
  const canonicalB = stableStringify({
    metadata: { nullable: null, enabled: true, retry: 0, channel: 'stable' },
    artifact: { sha256: 'a'.repeat(64), size: 42, url: 'https://example.invalid/llera.bin' },
    version: '5.4.0'
  });
  assert.equal(canonicalA, canonicalB, 'plain JSON objects must remain order-independent');

  assert.throws(() => stableStringify({ metadata: { retry: NaN } }), /non-finite number/);
  assert.throws(() => stableStringify({ metadata: { retry: Infinity } }), /non-finite number/);
  assert.throws(() => stableStringify({ metadata: { retry: -Infinity } }), /non-finite number/);
  assert.throws(() => stableStringify({ metadata: undefined }), /unsupported undefined/);
  assert.throws(() => stableStringify([1, undefined]), /unsupported undefined/);
  assert.throws(() => stableStringify({ metadata: () => 'x' }), /unsupported function/);
  assert.throws(() => stableStringify({ metadata: 1n }), /unsupported bigint/);
  assert.throws(() => stableStringify({ metadata: new Date('2026-09-03T00:00:00Z') }), /non-plain object/);

  const cyclic = { version: '5.4.0' };
  cyclic.self = cyclic;
  assert.throws(() => stableStringify(cyclic), /cyclic value/);

  assert.equal(stableStringify({ metadata: null }), '{"metadata":null}');
  console.log('signed updater manifest canonicalization fail-closed PASS');
})();
