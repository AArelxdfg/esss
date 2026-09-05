'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { VisionPipeline } = require('../src/vision-pipeline');

const pipeline = new VisionPipeline();
const bytes = Buffer.from('MONOLITH VISION INPUT');
let effects = 0;

function valid(overrides = {}) {
  return {
    bytes,
    kind: 'image',
    mime: 'image/png',
    source: 'clipboard',
    ...overrides,
  };
}

for (const [key, value] of [
  ['kind', { toString() { effects += 1; return 'image'; } }],
  ['mime', { toString() { effects += 1; return 'image/png'; } }],
  ['source', { toString() { effects += 1; return 'clipboard'; } }],
]) {
  assert.throws(
    () => pipeline.normalizeInput(valid({ [key]: value })),
    (error) => error && error.code === 'VISION_INPUT_TYPE_INVALID',
  );
  assert.strictEqual(effects, 0, `${key} coercion must not execute`);
}

const bytesAccessor = {
  kind: 'image',
  mime: 'image/png',
  source: 'clipboard',
};
Object.defineProperty(bytesAccessor, 'bytes', {
  enumerable: true,
  get() {
    effects += 1;
    return bytes;
  },
});
assert.throws(
  () => pipeline.normalizeInput(bytesAccessor),
  (error) => error && error.code === 'VISION_INPUT_ACCESSOR_REJECTED',
);
assert.strictEqual(effects, 0, 'bytes accessor must not execute');

const sourceAccessor = {
  bytes,
  kind: 'image',
  mime: 'image/png',
};
Object.defineProperty(sourceAccessor, 'source', {
  enumerable: true,
  get() {
    effects += 1;
    return 'clipboard';
  },
});
assert.throws(
  () => pipeline.normalizeInput(sourceAccessor),
  (error) => error && error.code === 'VISION_INPUT_ACCESSOR_REJECTED',
);
assert.strictEqual(effects, 0, 'source accessor must not execute');

const normalized = pipeline.normalizeInput(valid());
assert.strictEqual(normalized.kind, 'image');
assert.strictEqual(normalized.mime, 'image/png');
assert.strictEqual(normalized.source, 'clipboard');
assert.strictEqual(normalized.byteCount, bytes.length);
assert.strictEqual(normalized.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
assert.ok(normalized.inputId.startsWith('vision_'));
assert.notStrictEqual(normalized.bytes, bytes);
assert.deepStrictEqual(normalized.bytes, bytes);

bytes.fill(0);
assert.strictEqual(
  normalized.sha256,
  crypto.createHash('sha256').update(Buffer.from('MONOLITH VISION INPUT')).digest('hex'),
  'normalized provenance must remain bound to snapshotted bytes',
);

console.log('MONOLITH vision input coercion boundary PASS', {
  coerciveKindRejected: true,
  coerciveMimeRejected: true,
  coerciveSourceRejected: true,
  bytesAccessorRejected: true,
  sourceAccessorRejected: true,
  snapshotPreserved: true,
});
