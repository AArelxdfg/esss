'use strict';

const assert = require('assert');
const {
  VisionPipeline,
  DEFAULT_MAX_MIME_BYTES,
  DEFAULT_MAX_SOURCE_BYTES,
} = require('../src/vision-pipeline');

(() => {
  const pipeline = new VisionPipeline();
  const bytes = Buffer.from('MONOLITH METADATA BOUNDARY');

  assert.throws(
    () => pipeline.normalizeInput({ bytes, kind: 'image', mime: 'image/png\r\nX-Evil: 1' }),
    (error) => error && error.code === 'VISION_INPUT_METADATA_INVALID',
  );

  assert.throws(
    () => pipeline.normalizeInput({ bytes, kind: 'image', source: 'screen\0redirect' }),
    (error) => error && error.code === 'VISION_INPUT_METADATA_INVALID',
  );

  assert.throws(
    () => pipeline.normalizeInput({ bytes, kind: 'image', mime: `image/${'a'.repeat(DEFAULT_MAX_MIME_BYTES)}` }),
    (error) => error && error.code === 'VISION_INPUT_METADATA_INVALID',
  );

  assert.throws(
    () => pipeline.normalizeInput({ bytes, kind: 'screen', source: 's'.repeat(DEFAULT_MAX_SOURCE_BYTES + 1) }),
    (error) => error && error.code === 'VISION_INPUT_METADATA_INVALID',
  );

  const valid = pipeline.normalizeInput({
    bytes,
    kind: 'image',
    mime: 'image/png',
    source: 'clipboard:image',
  });

  assert.strictEqual(valid.mime, 'image/png');
  assert.strictEqual(valid.source, 'clipboard:image');
  assert.strictEqual(valid.byteCount, bytes.length);
  assert.strictEqual(valid.sha256.length, 64);

  console.log('MONOLITH vision metadata boundary PASS', {
    mimeControlCharactersRejected: true,
    sourceControlCharactersRejected: true,
    mimeByteLimitEnforced: true,
    sourceByteLimitEnforced: true,
  });
})();
