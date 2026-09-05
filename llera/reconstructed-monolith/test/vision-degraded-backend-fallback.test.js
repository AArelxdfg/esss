'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { VisionPipeline } = require('../src/vision-pipeline');

test('VisionPipeline preserves OCR result when vision backend fails', async () => {
  const pipeline = new VisionPipeline({ now: () => '2026-09-05T10:00:00.000Z' });
  const input = {
    kind: 'image',
    mime: 'image/png',
    source: 'fallback-ocr.png',
    bytes: Buffer.from('MONOLITH OCR TEST 2026'),
  };

  const result = await pipeline.analyze(input, {
    visionModel: async () => { throw new Error('vision unavailable'); },
    ocr: async () => 'MONOLITH OCR TEST 2026',
  });

  assert.equal(result.ok, true);
  assert.equal(result.degraded, true);
  assert.equal(result.backend, 'windows-ocr');
  assert.equal(result.text, 'MONOLITH OCR TEST 2026');
  assert.equal(result.vision, null);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].backend, 'vision-4b');
  assert.match(result.warnings[0].reason, /vision unavailable/);
  assert.equal(result.sha256.length, 64);
  assert.match(result.inputId, /^vision_[a-f0-9]{24}$/);
  assert.equal(pipeline.active, null);
  assert.equal(pipeline.history.length, 1);
  assert.equal(pipeline.history[0].backend, 'windows-ocr');
  assert.equal(pipeline.history[0].degraded, true);
});

test('VisionPipeline preserves vision result when OCR backend fails', async () => {
  const pipeline = new VisionPipeline({ now: () => '2026-09-05T10:01:00.000Z' });
  const input = {
    kind: 'screen',
    mime: 'image/png',
    source: 'screen-capture',
    bytes: Buffer.from('screen-bytes'),
  };

  const result = await pipeline.analyze(input, {
    visionModel: async () => ({ caption: 'MONOLITH workspace', confidence: 0.9 }),
    ocr: async () => { throw new Error('windows OCR unavailable'); },
  });

  assert.equal(result.ok, true);
  assert.equal(result.degraded, true);
  assert.equal(result.backend, 'vision-4b');
  assert.equal(result.text, '');
  assert.equal(result.vision.caption, 'MONOLITH workspace');
  assert.equal(result.vision.confidence, 0.9);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].backend, 'windows-ocr');
  assert.match(result.warnings[0].reason, /windows OCR unavailable/);
  assert.equal(pipeline.active, null);
  assert.equal(pipeline.history.length, 1);
  assert.equal(pipeline.history[0].backend, 'vision-4b');
  assert.equal(pipeline.history[0].degraded, true);
});
