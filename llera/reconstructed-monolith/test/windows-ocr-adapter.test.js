'use strict';

const assert = require('assert');
const { WindowsOcrAdapter, windowsOcrScript } = require('../src/windows-ocr-adapter');

(async () => {
  const writes = [];
  const unlinks = [];
  const calls = [];
  const fsPromises = {
    async writeFile(file, bytes, options) {
      writes.push({ file, bytes: Buffer.from(bytes), options });
    },
    async unlink(file) { unlinks.push(file); }
  };
  const adapter = new WindowsOcrAdapter({
    platform: 'win32',
    tmpDir: '/tmp/llera-ocr-test',
    fsPromises,
    execFile: async (exe, args, options) => {
      calls.push({ exe, args, options });
      return { stdout: JSON.stringify({ ok:true, engine:'Windows.Media.Ocr', text:'MONOLITH OCR TEST 2026', width:640, height:200 }) };
    }
  });

  const source = Buffer.from('fake-png-bytes');
  const text = await adapter.recognize({ bytes:source, mime:'image/png' });
  assert.strictEqual(text, 'MONOLITH OCR TEST 2026');
  assert.strictEqual(writes.length, 1);
  assert.deepStrictEqual(writes[0].bytes, source);
  assert.strictEqual(writes[0].options.flag, 'wx');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].exe, 'powershell.exe');
  assert.strictEqual(calls[0].options.shell, false);
  assert.strictEqual(calls[0].options.windowsHide, true);
  assert(calls[0].args.includes('-EncodedCommand'));
  assert.strictEqual(unlinks.length, 1);
  assert.strictEqual(unlinks[0], writes[0].file, 'OCR temp bytes must be removed after recognition');

  const unavailable = new WindowsOcrAdapter({ platform:'linux', fsPromises, execFile:async()=>({stdout:''}) });
  await assert.rejects(
    unavailable.recognize({ bytes:source, mime:'image/png' }),
    error => error && error.code === 'WINDOWS_OCR_PLATFORM_UNAVAILABLE'
  );

  await assert.rejects(
    adapter.recognize({ bytes:source, mime:'application/pdf' }),
    error => error && error.code === 'WINDOWS_OCR_MIME_UNSUPPORTED'
  );

  let cleanedFailure = false;
  const failing = new WindowsOcrAdapter({
    platform:'win32',
    tmpDir:'/tmp/llera-ocr-failure',
    fsPromises:{
      async writeFile() {},
      async unlink() { cleanedFailure = true; }
    },
    execFile:async()=>{ throw new Error('powershell failed'); }
  });
  await assert.rejects(
    failing.recognize({ bytes:source, mime:'image/jpeg' }),
    error => error && error.code === 'WINDOWS_OCR_EXECUTION_FAILED'
  );
  assert.strictEqual(cleanedFailure, true, 'OCR temp bytes must be removed after backend failure');

  const malformed = new WindowsOcrAdapter({
    platform:'win32',
    fsPromises:{ async writeFile(){}, async unlink(){} },
    execFile:async()=>({stdout:'not-json'})
  });
  await assert.rejects(
    malformed.recognize({ bytes:source, mime:'image/bmp' }),
    error => error && error.code === 'WINDOWS_OCR_OUTPUT_INVALID'
  );

  const script = windowsOcrScript('C:\\Users\\AArel\\AppData\\Local\\Temp\\llera image.png');
  assert(script.includes('Windows.Media.Ocr.OcrEngine'));
  assert(script.includes('TryCreateFromUserProfileLanguages'));
  assert(!script.includes('C:\\Users\\AArel'), 'raw path must not be interpolated into PowerShell');

  console.log(JSON.stringify({ok:true,windowsOcrAdapter:true,tempCleanup:true,noShell:true,historicalWinRtEngine:true}));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
