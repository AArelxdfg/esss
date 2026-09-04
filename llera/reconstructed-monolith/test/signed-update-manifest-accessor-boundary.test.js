'use strict';

const assert = require('node:assert');
const { stableStringify } = require('../src/signed-update-lifecycle');

let getterCalls = 0;
const accessorManifest = { version: '5.4.0' };
Object.defineProperty(accessorManifest, 'artifact', {
  enumerable: true,
  get() {
    getterCalls += 1;
    throw new Error('getter must never execute');
  }
});
assert.throws(() => stableStringify(accessorManifest), /accessor property/);
assert.strictEqual(getterCalls, 0, 'canonicalization must inspect descriptors without executing getters');

const nested = { artifact: {} };
Object.defineProperty(nested.artifact, 'sha256', {
  enumerable: true,
  get() {
    getterCalls += 1;
    return 'a'.repeat(64);
  }
});
assert.throws(() => stableStringify(nested), /accessor property/);
assert.strictEqual(getterCalls, 0, 'nested accessors must remain side-effect free');

const sparse = [];
sparse.length = 2;
sparse[1] = 'x';
assert.throws(() => stableStringify(sparse), /sparse or decorated array/);

const decorated = ['x'];
decorated.extra = true;
assert.throws(() => stableStringify(decorated), /sparse or decorated array|non-JSON array property/);

const nonEnumerable = { version: '5.4.0' };
Object.defineProperty(nonEnumerable, 'hidden', { value: 'ambiguous', enumerable: false });
assert.throws(() => stableStringify(nonEnumerable), /non-enumerable property/);

const symbolKeyed = { version: '5.4.0' };
symbolKeyed[Symbol('hidden')] = true;
assert.throws(() => stableStringify(symbolKeyed), /symbol keys/);

assert.strictEqual(
  stableStringify({ artifact: { size: 3, sha256: 'a'.repeat(64), url: 'https://example.invalid/x' }, version: '5.4.0', tags: ['a', 'b'] }),
  `{"artifact":{"sha256":"${'a'.repeat(64)}","size":3,"url":"https://example.invalid/x"},"tags":["a","b"],"version":"5.4.0"}`
);

console.log('signed updater manifest accessor boundary regression PASS');
