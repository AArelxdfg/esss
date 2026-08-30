'use strict';
const assert = require('assert');
const crypto = require('crypto');
const { VisionPipeline } = require('../src/vision-pipeline');

(async () => {
  const pipeline = new VisionPipeline({ now: () => '2026-08-30T04:52:35+03:00' });
  const original = Buffer.from('immutable-vision-payload');
  const expectedSha = crypto.createHash('sha256').update(original).digest('hex');
  let visionBytes;
  let ocrBytes;

  const result = await pipeline.analyze(
    { kind: 'image', mime: 'image/png', source: 'snapshot.png', bytes: original },
    {
      visionModel: async input => {
        visionBytes = Buffer.from(input.bytes);
        input.bytes.fill(0x41);
        original.fill(0x42);
        return { caption: 'vision-ok' };
      },
      ocr: async input => {
        ocrBytes = Buffer.from(input.bytes);
        return 'ocr-ok';
      }
    }
  );

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.backend, 'vision-4b+windows-ocr');
  assert.strictEqual(result.sha256, expectedSha);
  assert.strictEqual(visionBytes.toString(), 'immutable-vision-payload');
  assert.strictEqual(ocrBytes.toString(), 'immutable-vision-payload');
  assert.strictEqual(result.text, 'ocr-ok');
  assert.deepStrictEqual(result.vision, { caption: 'vision-ok' });
  assert.strictEqual(pipeline.history[0].sha256, expectedSha);

  console.log('MONOLITH vision input snapshot isolation PASS', {
    callerMutationIsolated: true,
    backendMutationIsolated: true,
    crossBackendIsolation: true,
    sha256BoundToSnapshot: true
  });
})().catch(err => { console.error(err); process.exit(1); });
