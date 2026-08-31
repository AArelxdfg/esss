'use strict';

const assert = require('assert');
const { VisionPipeline } = require('../src/vision-pipeline');

(async () => {
  const pipeline = new VisionPipeline({now:() => '2026-09-01T00:00:00.000Z'});
  const original = Buffer.from('canonical-image-bytes');
  const backendInputs = [];
  const result = await pipeline.analyze(
    {kind:'image',mime:'image/png',source:'C:/LLera/input.png',bytes:original},
    {
      visionModel: async input => { backendInputs.push(input); input.bytes.fill(0); return {caption:'image'}; },
      ocr: async input => { backendInputs.push(input); return 'text'; }
    }
  );
  assert.strictEqual(backendInputs.length,2);
  assert.notStrictEqual(backendInputs[0].bytes, backendInputs[1].bytes);
  assert.strictEqual(result.sha256, pipeline.history[0].sha256);
  assert.strictEqual(result.inputId, pipeline.history[0].inputId);
  assert.match(result.inputId,/^vision_[a-f0-9]{24}$/);
  assert.strictEqual(original.toString(),'canonical-image-bytes');

  const equivalent = pipeline.normalizeInput({kind:'image',mime:'image/png',source:'C:/LLera/input.png',bytes:Buffer.from('canonical-image-bytes')});
  assert.strictEqual(equivalent.inputId,result.inputId);
  assert.throws(() => pipeline.normalizeInput({kind:'image',mime:'image/png',source:'safe\nspoof',bytes:Buffer.from('x')}),/unsafe vision input source/);
  assert.throws(() => pipeline.normalizeInput({kind:'image',mime:'image/png',source:'safe\0spoof',bytes:Buffer.from('x')}),/unsafe vision input source/);

  console.log('MONOLITH vision input provenance PASS', {
    immutableCanonicalSnapshot:true,
    isolatedBackendBuffers:true,
    deterministicInputId:true,
    sourceSpoofRejected:true
  });
})().catch(error => { console.error(error); process.exit(1); });
