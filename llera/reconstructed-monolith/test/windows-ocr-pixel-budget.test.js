'use strict';

const assert = require('assert');
const {
  WindowsOcrAdapter,
  windowsOcrScript,
  DEFAULT_MAX_PIXELS
} = require('../src/windows-ocr-adapter');

(async () => {
  const script = windowsOcrScript('C:\\Temp\\llera-ocr.png', 1234567);
  assert(script.includes('$d.PixelWidth'));
  assert(script.includes('$d.PixelHeight'));
  assert(script.includes('($w*$h) -gt 1234567'));
  assert(script.includes("throw 'WINDOWS_OCR_PIXEL_LIMIT'"));
  assert(script.indexOf('WINDOWS_OCR_PIXEL_LIMIT') < script.indexOf('GetSoftwareBitmapAsync'), 'pixel budget must run before bitmap materialization');
  assert.strictEqual(DEFAULT_MAX_PIXELS, 40_000_000);
  assert.throws(() => windowsOcrScript('C:\\Temp\\x.png', 0), RangeError);
  assert.throws(() => new WindowsOcrAdapter({ maxPixels: Number.MAX_SAFE_INTEGER + 1 }), RangeError);

  let cleaned = false;
  const adapter = new WindowsOcrAdapter({
    platform: 'win32',
    tmpDir: '/tmp/llera-ocr-pixel-budget',
    maxPixels: 1_000_000,
    fsPromises: {
      async writeFile() {},
      async unlink() { cleaned = true; }
    },
    execFile: async () => {
      const error = new Error('PowerShell failed');
      error.stderr = 'WINDOWS_OCR_PIXEL_LIMIT';
      throw error;
    }
  });

  await assert.rejects(
    adapter.recognize({ bytes: Buffer.from('fake-image'), mime: 'image/png' }),
    error => error && error.code === 'WINDOWS_OCR_PIXEL_LIMIT'
  );
  assert.strictEqual(cleaned, true, 'OCR temp bytes must still be removed after pixel-budget rejection');

  console.log(JSON.stringify({
    ok: true,
    decodedPixelBudget: true,
    preMaterializationGate: true,
    stableErrorCode: 'WINDOWS_OCR_PIXEL_LIMIT',
    tempCleanup: true
  }));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
