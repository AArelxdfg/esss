'use strict';

const assert = require('assert');
const { VisionPipeline, normalizePressure } = require('../src/vision-pipeline');

(async () => {
  const pipeline = new VisionPipeline({
    now: (() => {
      let i = 0;
      return () => `2026-09-04T00:00:0${i++}.000Z`;
    })()
  });
  const input = {
    kind: 'image',
    mime: 'image/png',
    source: 'pressure-regression.png',
    bytes: Buffer.from('MONOLITH PRESSURE TEST')
  };

  assert.strictEqual(normalizePressure('NORMAL'), 'normal');
  assert.strictEqual(normalizePressure('Elevated'), 'elevated');
  assert.strictEqual(normalizePressure('CRITICAL'), 'critical');

  for (const badPressure of [null, undefined, 1, {}, [], 'critical ', 'unknown', '']) {
    if (badPressure === undefined) continue;
    assert.throws(() => normalizePressure(badPressure), error => error && error.code === 'VISION_PRESSURE_INVALID');
  }

  let backendCalls = 0;
  const blocked = await pipeline.analyze(input, {
    pressure: 'CRITICAL',
    visionModel: async () => {
      backendCalls += 1;
      return { description: 'must not execute under critical pressure' };
    },
    ocr: async () => {
      backendCalls += 1;
      return 'must not execute under critical pressure';
    }
  });

  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.blocked, true);
  assert.strictEqual(blocked.reason, 'host-critical-pressure');
  assert.strictEqual(blocked.pressure, 'critical');
  assert.strictEqual(backendCalls, 0, 'critical pressure must block every vision/OCR backend before execution');
  assert.strictEqual(pipeline.active, null);

  await assert.rejects(
    () => pipeline.analyze(input, {
      pressure: { toString: () => 'critical' },
      visionModel: async () => ({ ok: true })
    }),
    error => error && error.code === 'VISION_PRESSURE_INVALID'
  );

  await assert.rejects(
    () => pipeline.analyze(input, {
      pressure: 'critical ',
      visionModel: async () => ({ ok: true })
    }),
    error => error && error.code === 'VISION_PRESSURE_INVALID'
  );

  const elevated = await pipeline.analyze(input, {
    pressure: 'ELEVATED',
    ocr: async () => 'MONOLITH OCR'
  });
  assert.strictEqual(elevated.ok, true);
  assert.strictEqual(elevated.pressure, 'elevated');
  assert.strictEqual(elevated.text, 'MONOLITH OCR');
  assert.strictEqual(pipeline.history.at(-1).pressure, 'elevated');

  console.log('Vision pipeline HOSTGUARD pressure gate regression PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
