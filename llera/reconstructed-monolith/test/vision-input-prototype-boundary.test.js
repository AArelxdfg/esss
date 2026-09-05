'use strict';

const assert = require('assert');
const { VisionPipeline } = require('../src/vision-pipeline');

(() => {
  let inheritedEffects = 0;
  const inheritedMetadata = {};
  Object.defineProperties(inheritedMetadata, {
    mime: {
      enumerable: true,
      get() {
        inheritedEffects += 1;
        throw new Error('inherited mime getter must never execute');
      },
    },
    source: {
      enumerable: true,
      get() {
        inheritedEffects += 1;
        throw new Error('inherited source getter must never execute');
      },
    },
  });

  const input = Object.create(inheritedMetadata);
  Object.defineProperties(input, {
    bytes: { enumerable: true, value: Buffer.from('MONOLITH PROTOTYPE INPUT') },
    kind: { enumerable: true, value: 'image' },
  });

  const pipeline = new VisionPipeline();
  const normalized = pipeline.normalizeInput(input);

  assert.strictEqual(inheritedEffects, 0, 'inherited metadata accessors must not execute');
  assert.strictEqual(normalized.kind, 'image');
  assert.strictEqual(normalized.mime, 'application/octet-stream');
  assert.strictEqual(normalized.source, 'image');
  assert.strictEqual(normalized.byteCount, Buffer.byteLength('MONOLITH PROTOTYPE INPUT'));
  assert.strictEqual(normalized.sha256.length, 64);
  assert.ok(normalized.inputId.startsWith('vision_'));

  let inheritedBytesEffects = 0;
  const inheritedBytes = {};
  Object.defineProperty(inheritedBytes, 'bytes', {
    enumerable: true,
    get() {
      inheritedBytesEffects += 1;
      return Buffer.from('ATTACKER CONTROLLED');
    },
  });

  const missingOwnBytes = Object.create(inheritedBytes);
  Object.defineProperty(missingOwnBytes, 'kind', { enumerable: true, value: 'image' });

  assert.throws(
    () => pipeline.normalizeInput(missingOwnBytes),
    /vision input bytes required/,
  );
  assert.strictEqual(inheritedBytesEffects, 0, 'inherited bytes accessor must not execute');

  let inheritedKindEffects = 0;
  const inheritedKind = {};
  Object.defineProperty(inheritedKind, 'kind', {
    enumerable: true,
    get() {
      inheritedKindEffects += 1;
      return 'screen';
    },
  });

  const missingOwnKind = Object.create(inheritedKind);
  Object.defineProperty(missingOwnKind, 'bytes', {
    enumerable: true,
    value: Buffer.from('OWN BYTES'),
  });

  assert.throws(
    () => pipeline.normalizeInput(missingOwnKind),
    (error) => error && error.code === 'VISION_INPUT_TYPE_INVALID',
  );
  assert.strictEqual(inheritedKindEffects, 0, 'inherited kind accessor must not execute');

  console.log('MONOLITH vision input prototype boundary PASS', {
    inheritedMetadataAccessorsIgnored: true,
    inheritedBytesAccessorIgnored: true,
    inheritedKindAccessorIgnored: true,
    ownDataPropertiesRequired: true,
  });
})();
