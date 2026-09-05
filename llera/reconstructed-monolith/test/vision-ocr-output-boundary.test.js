'use strict';

const assert = require('assert');
const { VisionPipeline, normalizeOcrText } = require('../src/vision-pipeline');

(async () => {
  const bytes = Buffer.from('MONOLITH OCR TEST 2026');
  const input = {
    bytes,
    kind: 'image',
    mime: 'image/png',
    source: 'ocr-boundary-test',
  };

  let effects = 0;
  const pipeline = new VisionPipeline();

  await assert.rejects(
    () => pipeline.analyze(input, {
      ocr: async () => ({
        toString() {
          effects += 1;
          return 'MONOLITH OCR TEST 2026';
        },
      }),
    }),
    (error) => error
      && error.code === 'VISION_BACKENDS_FAILED'
      && Array.isArray(error.backendFailures)
      && error.backendFailures.some((failure) => /OCR backend output must be string/.test(failure.reason)),
  );

  assert.strictEqual(effects, 0, 'OCR result coercion must not execute attacker-controlled toString');
  assert.strictEqual(pipeline.active, null, 'failed OCR must release the single-flight slot');

  assert.throws(
    () => normalizeOcrText('🙂🙂🙂', { maxBytes: 11 }),
    (error) => error && error.code === 'VISION_OCR_OUTPUT_INVALID' && /exceeds byte limit/.test(error.message),
  );
  assert.throws(
    () => normalizeOcrText('ok', { maxBytes: Number.POSITIVE_INFINITY }),
    (error) => error && error.code === 'VISION_OCR_OUTPUT_INVALID' && /positive safe integer/.test(error.message),
  );
  assert.strictEqual(normalizeOcrText('🙂🙂🙂', { maxBytes: 12 }), '🙂🙂🙂');

  const result = await pipeline.analyze(input, {
    ocr: async () => 'MONOLITH OCR TEST 2026',
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.backend, 'windows-ocr');
  assert.strictEqual(result.text, 'MONOLITH OCR TEST 2026');
  assert.strictEqual(result.sha256.length, 64);
  assert.ok(result.inputId.startsWith('vision_'));
  assert.strictEqual(pipeline.active, null);

  console.log('MONOLITH vision OCR output boundary PASS', {
    coerciveOutputRejected: true,
    sideEffects: effects,
    utf8ByteBudgetEnforced: true,
    invalidByteBudgetRejected: true,
    validStringAccepted: true,
    singleFlightReleased: true,
  });
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
