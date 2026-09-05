'use strict';

const assert = require('assert');
const { VisionPipeline } = require('../src/vision-pipeline');

(() => {
  assert.throws(
    () => new VisionPipeline({ maxBytes: Number.POSITIVE_INFINITY }),
    (error) => error && error.code === 'VISION_INPUT_LIMIT_INVALID' && /positive safe integer/.test(error.message),
  );
  assert.throws(
    () => new VisionPipeline({ maxSourceBytes: 0 }),
    (error) => error && error.code === 'VISION_INPUT_LIMIT_INVALID',
  );
  assert.throws(
    () => new VisionPipeline({ maxMimeBytes: -1 }),
    (error) => error && error.code === 'VISION_INPUT_LIMIT_INVALID',
  );

  const bytes = Buffer.from('MONOLITH INPUT METADATA TEST');
  const pipeline = new VisionPipeline({ maxSourceBytes: 8, maxMimeBytes: 16 });

  assert.throws(
    () => pipeline.normalizeInput({ kind: 'image', mime: 'image/png', source: '123456789', bytes }),
    (error) => error && error.code === 'VISION_INPUT_METADATA_INVALID' && /source exceeds byte limit/.test(error.message),
  );
  assert.throws(
    () => pipeline.normalizeInput({ kind: 'image', mime: 'application/x-too-long', source: 'camera', bytes }),
    (error) => error && error.code === 'VISION_INPUT_METADATA_INVALID' && /mime exceeds byte limit/.test(error.message),
  );

  const utf8Pipeline = new VisionPipeline({ maxSourceBytes: 8, maxMimeBytes: 32 });
  assert.throws(
    () => utf8Pipeline.normalizeInput({ kind: 'image', mime: 'image/png', source: '🙂🙂🙂', bytes }),
    (error) => error && error.code === 'VISION_INPUT_METADATA_INVALID',
  );
  const valid = utf8Pipeline.normalizeInput({ kind: 'image', mime: 'image/png', source: '🙂🙂', bytes });
  assert.strictEqual(valid.source, '🙂🙂');
  assert.strictEqual(valid.bytes.equals(bytes), true);
  assert.match(valid.sha256, /^[a-f0-9]{64}$/);

  console.log('MONOLITH vision input metadata boundary PASS', {
    invalidConstructorLimitsRejected: true,
    sourceByteBudgetEnforced: true,
    mimeByteBudgetEnforced: true,
    utf8ByteBudgetEnforced: true,
    validInputPreserved: true,
  });
})();
