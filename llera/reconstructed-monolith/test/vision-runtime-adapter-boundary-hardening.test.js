'use strict';
const assert = require('assert');
const { VisionPipeline } = require('../src/vision-pipeline');
const { VisionRuntimeAdapter } = require('../src/vision-runtime-adapter');

function makeAdapter(overrides = {}) {
  return new VisionRuntimeAdapter({
    pipeline: new VisionPipeline({ maxBytes: 1024 }),
    readFile: async () => Buffer.from('ok'),
    statFile: async () => ({ isFile: () => true, size: 2 }),
    captureScreen: async () => ({ bytes: Buffer.from('screen'), mime: 'image/png', source: 'screen:0' }),
    windowsOcr: async () => 'ocr',
    ...overrides
  });
}

(async () => {
  await assert.rejects(
    () => makeAdapter().analyze({ bytes: Buffer.from('x'), kind: { toString: () => 'image' }, mime: 'image/png' }),
    /kind must be a string/
  );

  await assert.rejects(
    () => makeAdapter().analyze({ bytes: Buffer.from('x'), kind: 'image', mime: { toString: () => 'image\/png' } }),
    /mime must be a string/
  );

  await assert.rejects(
    () => makeAdapter().analyze({ bytes: Buffer.from('x'), kind: 'image', source: { toString: () => 'memory' } }),
    /source must be a string/
  );

  await assert.rejects(
    () => makeAdapter({ statFile: async () => ({ isFile: () => false, size: 2 }) }).analyze({ path: 'folder.png' }),
    /path is not a file/
  );

  for (const badSize of ['2', NaN, Infinity, -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      () => makeAdapter({ statFile: async () => ({ isFile: () => true, size: badSize }) }).analyze({ path: 'photo.png' }),
      /file size is invalid/
    );
  }

  await assert.rejects(
    () => makeAdapter({ captureScreen: async () => ({ bytes: Buffer.from('screen'), mime: { toString: () => 'image/png' } }) }).ocrScreen(),
    /mime must be a string/
  );

  await assert.rejects(
    () => makeAdapter({ captureScreen: async () => ({ bytes: Buffer.from('screen'), source: { toString: () => 'screen:0' } }) }).ocrScreen(),
    /source must be a string/
  );

  await assert.rejects(
    () => makeAdapter({ hostguard: { snapshot: async () => ({ pressure: { toString: () => 'critical' } }) } }).analyze({ bytes: Buffer.from('x'), kind: 'image', mime: 'image/png' }),
    /HOSTGUARD pressure must be a string/
  );

  const good = await makeAdapter().analyze({ path: 'photo.png' });
  assert.strictEqual(good.ok, true);
  assert.strictEqual(good.kind, 'image');
  assert.strictEqual(good.backend, 'windows-ocr');

  console.log('Vision runtime adapter boundary hardening PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
