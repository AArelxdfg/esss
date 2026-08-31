'use strict';
const assert = require('node:assert/strict');
const { VisionPipeline } = require('../src/vision-pipeline');

(async () => {
  const bytes = Buffer.from('same-visual-payload');
  const pipeline = new VisionPipeline({ now: () => '2026-08-31T04:40:26+03:00' });
  const seen = [];
  const visionModel = async input => {
    seen.push({
      kind: input.kind,
      mime: input.mime,
      source: input.source,
      sha256: input.sha256,
      inputId: input.inputId
    });
    return { ok: true };
  };

  const image = await pipeline.analyze(
    { kind: 'image', mime: 'image/png', source: 'capture.png', bytes },
    { visionModel }
  );
  const screen = await pipeline.analyze(
    { kind: 'screen', mime: 'image/png', source: 'capture.png', bytes },
    { visionModel }
  );
  const renamed = await pipeline.analyze(
    { kind: 'image', mime: 'image/png', source: 'other.png', bytes },
    { visionModel }
  );
  const remimed = await pipeline.analyze(
    { kind: 'image', mime: 'image/webp', source: 'capture.png', bytes },
    { visionModel }
  );

  assert.equal(image.sha256, screen.sha256);
  assert.equal(image.sha256, renamed.sha256);
  assert.equal(image.sha256, remimed.sha256);
  assert.notEqual(image.inputId, screen.inputId, 'kind retagging must change provenance identity');
  assert.notEqual(image.inputId, renamed.inputId, 'source retagging must change provenance identity');
  assert.notEqual(image.inputId, remimed.inputId, 'mime retagging must change provenance identity');
  assert.equal(seen[0].inputId, image.inputId, 'backend must receive the bound provenance identity');
  assert.equal(pipeline.history[0].inputId, image.inputId, 'history must retain the provenance identity');
  assert.equal(pipeline.history[0].source, 'capture.png');
  assert.equal(pipeline.history[0].mime, 'image/png');

  assert.throws(
    () => pipeline.normalizeInput({ kind: 'image', mime: 'image/png\r\nspoofed: 1', source: 'capture.png', bytes }),
    /invalid vision input mime/
  );
  assert.throws(
    () => pipeline.normalizeInput({ kind: 'image', mime: 'image/png', source: 'capture.png\nspoofed', bytes }),
    /invalid vision input source/
  );

  console.log('MONOLITH_VISION_PROVENANCE_IDENTITY_PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
