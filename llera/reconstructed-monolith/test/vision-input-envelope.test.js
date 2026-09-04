'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const {
  verifyVisionInput,
  buildOcrRequest,
} = require('../src/vision-input-envelope');

const payload = Buffer.from('MONOLITH OCR IMAGE BYTES');
const sha256 = crypto.createHash('sha256').update(payload).digest('hex');
const base = {
  id: 'vision-test-1',
  name: 'ocr-test.png',
  type: 'image/png',
  bytes: payload.length,
  sha256,
  sourceKind: 'image-file',
};

const verified = verifyVisionInput({ metadata: base, bytes: payload });
assert.strictEqual(verified.sha256, sha256);
assert.strictEqual(verified.bytes, payload.length);
assert.strictEqual(verified.sourceKind, 'image-file');

const request = buildOcrRequest({ metadata: base, bytes: payload });
assert.strictEqual(request.schema, 1);
assert.strictEqual(request.inputId, base.id);
assert.strictEqual(request.sha256, sha256);
assert.deepStrictEqual(request.payload, payload);

assert.throws(
  () => verifyVisionInput({ metadata: base, bytes: Buffer.from('tampered') }),
  error => error && (error.code === 'VISION_SIZE_MISMATCH' || error.code === 'VISION_INTEGRITY_FAILED'),
);

assert.throws(
  () => verifyVisionInput({ metadata: { ...base, type: 'image/svg+xml' }, bytes: payload }),
  error => error?.code === 'VISION_MIME_UNSUPPORTED',
);

assert.throws(
  () => verifyVisionInput({ metadata: { ...base, sourceKind: 'remote-url' }, bytes: payload }),
  error => error?.code === 'VISION_SOURCE_INVALID',
);

let coercions = 0;
const coercive = { ...base };
Object.defineProperty(coercive, 'sha256', {
  enumerable: true,
  get() {
    coercions += 1;
    return sha256;
  },
});
assert.throws(
  () => verifyVisionInput({ metadata: coercive, bytes: payload }),
  error => error?.code === 'VISION_METADATA_INVALID',
);
assert.strictEqual(coercions, 0);

assert.throws(
  () => verifyVisionInput({ metadata: base, bytes: payload, maxBytes: payload.length - 1 }),
  error => error?.code === 'VISION_BYTES_TOO_LARGE',
);

console.log('MONOLITH vision input integrity boundary PASS');
