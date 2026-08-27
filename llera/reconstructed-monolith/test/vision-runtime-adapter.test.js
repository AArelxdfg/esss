'use strict';
const assert = require('assert');
const { VisionPipeline } = require('../src/vision-pipeline');
const { VisionRuntimeAdapter } = require('../src/vision-runtime-adapter');

(async () => {
  const files = new Map([['photo.png', Buffer.from('fake-png')], ['manual.pdf', Buffer.from('fake-pdf')]]);
  let pressure = 'normal';
  let captures = 0;
  const visionCalls = [];
  const ocrCalls = [];
  const adapter = new VisionRuntimeAdapter({
    pipeline: new VisionPipeline({ now: () => '2026-08-27T10:00:00+03:00' }),
    readFile: async p => { if (!files.has(p)) throw new Error('ENOENT'); return files.get(p); },
    statFile: async p => ({ isFile: files.has(p), size: files.has(p) ? files.get(p).length : 0 }),
    captureScreen: async () => { captures += 1; return { bytes: Buffer.from('screen-bytes'), mime: 'image/png', source: 'screen:0' }; },
    visionModel: async input => { visionCalls.push({kind:input.kind,mime:input.mime}); return {caption:`seen:${input.kind}`}; },
    windowsOcr: async input => { ocrCalls.push({kind:input.kind,mime:input.mime}); return `ocr:${input.kind}`; },
    hostguard: { snapshot: async () => ({ pressure }) }
  });
  const image = await adapter.analyze({ path:'photo.png' });
  assert.strictEqual(image.ok,true); assert.strictEqual(image.kind,'image'); assert.strictEqual(image.backend,'vision-4b+windows-ocr');
  const pdf = await adapter.analyze({ path:'manual.pdf' });
  assert.strictEqual(pdf.ok,true); assert.strictEqual(pdf.kind,'file'); assert.strictEqual(pdf.text,'ocr:file');
  const screen = await adapter.ocrScreen();
  assert.strictEqual(screen.ok,true); assert.strictEqual(screen.kind,'screen'); assert.strictEqual(screen.backend,'windows-ocr'); assert.strictEqual(captures,1);
  pressure='critical';
  const blocked = await adapter.analyze({ bytes:Buffer.from('x'), kind:'image', mime:'image/png' });
  assert.strictEqual(blocked.blocked,true); assert.strictEqual(blocked.reason,'host-critical-pressure');
  assert.deepStrictEqual(visionCalls.map(x=>x.kind),['image','file']);
  assert.deepStrictEqual(ocrCalls.map(x=>x.kind),['image','file','screen']);
  console.log('Vision runtime adapter PASS', {imagePath:true,filePdf:true,screenCapture:true,windowsOcr:true,hostguardAdmission:true});
})().catch(err=>{console.error(err);process.exit(1);});
