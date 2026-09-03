'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { VisionPipeline } = require('../src/vision-pipeline');

(async () => {
  const bytes = Buffer.from('MONOLITH OCR TEST 2026', 'utf8');
  const expectedSha = crypto.createHash('sha256').update(bytes).digest('hex');
  const pipeline = new VisionPipeline({ maxBytes: 1024, now: () => '2026-09-03T20:56:00.000Z' });

  const normalized = pipeline.normalizeInput({
    kind: 'image',
    mime: 'image/png',
    source: 'acceptance-image',
    bytes
  });
  assert.equal(normalized.byteCount, bytes.length);
  assert.equal(normalized.sha256, expectedSha);
  assert.match(normalized.inputId, /^vision_[a-f0-9]{24}$/);

  const result = await pipeline.analyze(
    { kind: 'image', mime: 'image/png', source: 'acceptance-image', bytes },
    { ocr: async (input) => {
      assert.equal(input.byteCount, bytes.length);
      assert.equal(input.sha256, expectedSha);
      return 'MONOLITH OCR TEST 2026';
    } }
  );

  assert.equal(result.ok, true);
  assert.equal(result.byteCount, bytes.length);
  assert.equal(result.sha256, expectedSha);
  assert.equal(result.inputId, normalized.inputId);
  assert.equal(result.text, 'MONOLITH OCR TEST 2026');
  assert.equal(pipeline.history.length, 1);
  assert.equal(pipeline.history[0].byteCount, bytes.length);
  assert.equal(pipeline.history[0].sha256, expectedSha);
  assert.equal(pipeline.history[0].inputId, normalized.inputId);

  const blocked = await pipeline.analyze(
    { kind: 'screen', mime: 'image/png', source: 'pressure-screen', bytes },
    { pressure: 'critical', ocr: async () => { throw new Error('must not run'); } }
  );
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.byteCount, bytes.length);
  assert.equal(blocked.sha256, expectedSha);
  assert.match(blocked.inputId, /^vision_[a-f0-9]{24}$/);

  const changedLength = pipeline.normalizeInput({
    kind: 'image',
    mime: 'image/png',
    source: 'acceptance-image',
    bytes: Buffer.concat([bytes, Buffer.from('!')])
  });
  assert.notEqual(changedLength.inputId, normalized.inputId);

  console.log('MONOLITH vision byte evidence binding PASS', {
    byteCountBound: true,
    sha256Bound: true,
    inputIdentityBound: true,
    pressureBlockCarriesEvidence: true
  });
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
