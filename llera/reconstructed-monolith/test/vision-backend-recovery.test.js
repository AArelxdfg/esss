'use strict';
const assert = require('node:assert/strict');
const { VisionPipeline } = require('../src/vision-pipeline');

(async () => {
  const pipeline = new VisionPipeline({ now: (() => { let n = 0; return () => `t${++n}`; })() });
  const bytes = Buffer.from('fake-image-bytes');

  const ocrFallback = await pipeline.analyze(
    { kind: 'screen', mime: 'image/png', bytes, source: 'screen-1' },
    {
      visionModel: async () => { throw new Error('vision runtime unavailable'); },
      ocr: async () => 'OCR survived'
    }
  );
  assert.equal(ocrFallback.ok, true);
  assert.equal(ocrFallback.degraded, true);
  assert.equal(ocrFallback.backend, 'windows-ocr');
  assert.equal(ocrFallback.text, 'OCR survived');
  assert.equal(ocrFallback.warnings[0].backend, 'vision-4b');

  const visionFallback = await pipeline.analyze(
    { kind: 'image', mime: 'image/jpeg', bytes, source: 'image-1' },
    {
      visionModel: async () => ({ caption: 'visible' }),
      ocr: async () => { throw new Error('ocr unavailable'); }
    }
  );
  assert.equal(visionFallback.ok, true);
  assert.equal(visionFallback.degraded, true);
  assert.equal(visionFallback.backend, 'vision-4b');
  assert.deepEqual(visionFallback.vision, { caption: 'visible' });

  await assert.rejects(
    () => pipeline.analyze(
      { kind: 'screen', mime: 'image/png', bytes, source: 'screen-2' },
      {
        visionModel: async () => { throw new Error('vision down'); },
        ocr: async () => { throw new Error('ocr down'); }
      }
    ),
    (error) => error.code === 'VISION_BACKENDS_FAILED' && error.backendFailures.length === 2
  );
  assert.equal(pipeline.active, null);

  const critical = await pipeline.analyze(
    { kind: 'screen', mime: 'image/png', bytes, source: 'screen-3' },
    { pressure: 'critical', visionModel: async () => ({}) }
  );
  assert.equal(critical.blocked, true);
  assert.equal(critical.reason, 'host-critical-pressure');

  console.log('MONOLITH vision backend recovery PASS', {
    visionFailureFallsBackToOcr: true,
    ocrFailurePreservesVision: true,
    allBackendsFailClosed: true,
    hostCriticalPressureStillBlocks: true
  });
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
