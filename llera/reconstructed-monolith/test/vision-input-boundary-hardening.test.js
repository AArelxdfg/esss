'use strict';
const assert = require('node:assert/strict');
const { VisionPipeline } = require('../src/vision-pipeline');

(async () => {
  for (const maxBytes of [0, -1, NaN, Infinity, '1024', 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => new VisionPipeline({ maxBytes }),
      (error) => error && error.code === 'VISION_MAX_BYTES_INVALID'
    );
  }
  assert.throws(
    () => new VisionPipeline({ now: 'clock' }),
    (error) => error && error.code === 'VISION_CLOCK_INVALID'
  );

  const pipeline = new VisionPipeline({ maxBytes: 4, now: () => 't1' });
  assert.throws(
    () => pipeline.normalizeInput({ kind: 'image', bytes: Buffer.alloc(5) }),
    /exceeds size limit/
  );
  assert.throws(
    () => pipeline.normalizeInput({ kind: { toString: () => 'image' }, bytes: Buffer.from('a') }),
    /kind must be a string/
  );
  assert.throws(
    () => pipeline.normalizeInput({ kind: 'image', mime: { toString: () => 'image/png' }, bytes: Buffer.from('a') }),
    /mime must be a string/
  );
  assert.throws(
    () => pipeline.normalizeInput({ kind: 'image', source: { toString: () => 'camera' }, bytes: Buffer.from('a') }),
    /source must be a string/
  );
  assert.throws(
    () => pipeline.normalizeInput([{ kind: 'image', bytes: Buffer.from('a') }]),
    /vision input bytes required/
  );

  const ocrOnly = new VisionPipeline({ maxBytes: 1024, now: () => 't2' });
  await assert.rejects(
    () => ocrOnly.analyze(
      { kind: 'screen', mime: 'image/png', bytes: Buffer.from('screen'), source: 'screen-1' },
      { ocr: async () => ({ text: 'coerce me' }) }
    ),
    (error) => error && error.code === 'VISION_BACKENDS_FAILED' &&
      error.backendFailures.some((failure) => failure.backend === 'windows-ocr' && /must return a string/.test(failure.reason))
  );
  assert.equal(ocrOnly.active, null);

  const valid = await ocrOnly.analyze(
    { kind: 'screen', mime: 'image/png', bytes: Buffer.from('screen'), source: 'screen-2' },
    { ocr: async () => 'verified text' }
  );
  assert.equal(valid.ok, true);
  assert.equal(valid.backend, 'windows-ocr');
  assert.equal(valid.text, 'verified text');

  console.log('MONOLITH vision input boundary hardening PASS', {
    unsafeLimitCoercionRejected: true,
    metadataCoercionRejected: true,
    ocrTypeCoercionRejected: true,
    validOcrPreserved: true
  });
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
