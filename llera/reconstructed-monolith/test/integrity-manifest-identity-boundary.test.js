'use strict';

const assert = require('assert');
const {
  canonicalManifestPayload,
  validateManifest,
} = require('../src/integrity-sentinel');

const entry = {
  path: 'bin/llera.exe',
  sha256: 'a'.repeat(64),
  size: 123,
};

const invalidSchema = validateManifest({ schema: 0, product: 'LLera', version: '5.4.0', files: [entry] });
assert.strictEqual(invalidSchema.ok, false);
assert(invalidSchema.failures.some((failure) => failure.reason === 'invalid-schema'));

const invalidProduct = validateManifest({ schema: 1, product: '   ', version: '5.4.0', files: [entry] });
assert.strictEqual(invalidProduct.ok, false);
assert(invalidProduct.failures.some((failure) => failure.reason === 'invalid-product'));

const invalidVersion = validateManifest({ schema: 1, product: 'LLera', version: ['5.4.0'], files: [entry] });
assert.strictEqual(invalidVersion.ok, false);
assert(invalidVersion.failures.some((failure) => failure.reason === 'invalid-version'));

let coercions = 0;
const hostileProduct = {
  toString() {
    coercions += 1;
    throw new Error('product coercion attempted');
  },
  toJSON() {
    coercions += 1;
    throw new Error('product toJSON attempted');
  },
};

const hostileManifest = {
  schema: 1,
  product: hostileProduct,
  version: '5.4.0',
  files: [entry],
};
const hostileValidation = validateManifest(hostileManifest);
assert.strictEqual(hostileValidation.ok, false);
assert(hostileValidation.failures.some((failure) => failure.reason === 'invalid-product'));
assert.strictEqual(coercions, 0, 'manifest validation must reject hostile identity metadata before coercion');
assert.throws(
  () => canonicalManifestPayload(hostileManifest),
  (error) => error && error.code === 'INTEGRITY_MANIFEST_INVALID',
  'canonical signing payload must fail closed on invalid manifest identity metadata'
);
assert.strictEqual(coercions, 0, 'canonical payload rejection must not invoke hostile coercion hooks');

const validPayload = JSON.parse(canonicalManifestPayload({
  schema: 1,
  product: 'LLera',
  version: '5.4.0',
  files: [entry],
}));
assert.deepStrictEqual(validPayload, {
  schema: 1,
  product: 'LLera',
  version: '5.4.0',
  files: [entry],
});

console.log('MONOLITH integrity manifest identity boundary PASS', {
  invalidSchemaRejected: true,
  blankProductRejected: true,
  nonStringVersionRejected: true,
  hostileIdentityRejectedWithoutCoercion: true,
  canonicalPayloadFailsClosed: true,
  validPayloadPreserved: true,
});
