'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const {
  verifyVisionInput,
  buildOcrRequest,
} = require('../src/vision-input-envelope');

const original = Buffer.from('MONOLITH OCR ORIGINAL BYTES');
const originalBytes = Buffer.from(original);
const sha256 = crypto.createHash('sha256').update(originalBytes).digest('hex');
const metadata = {
  id: 'vision-toctou-1',
  name: 'ocr-toctou.png',
  type: 'image/png',
  bytes: originalBytes.length,
  sha256,
  sourceKind: 'image-file',
};

const verified = verifyVisionInput({ metadata, bytes: original });
const request = buildOcrRequest({ metadata, bytes: original });

// Mutating caller-owned bytes after verification must not mutate either
// verified snapshot or the OCR request that was bound to the original hash.
original.fill(0x58);
assert.deepStrictEqual(verified.data, originalBytes);
assert.deepStrictEqual(request.payload, originalBytes);
assert.strictEqual(
  crypto.createHash('sha256').update(request.payload).digest('hex'),
  request.sha256,
);

// The OCR request must also be detached from a previously returned verified
// snapshot so one consumer cannot alter another consumer's request bytes.
verified.data.fill(0x59);
assert.deepStrictEqual(request.payload, originalBytes);
assert.strictEqual(
  crypto.createHash('sha256').update(request.payload).digest('hex'),
  sha256,
);

assert.throws(
  () => verifyVisionInput({ metadata, bytes: { not: 'bytes' } }),
  error => error?.code === 'VISION_BYTES_INVALID',
);

console.log('MONOLITH vision OCR TOCTOU detach regression PASS');
