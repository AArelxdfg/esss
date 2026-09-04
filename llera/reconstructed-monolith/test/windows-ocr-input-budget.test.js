'use strict';

const assert = require('assert');
const { WindowsOcrAdapter, normalizeInput, DEFAULT_MAX_INPUT_BYTES } = require('../src/windows-ocr-adapter');

assert.strictEqual(DEFAULT_MAX_INPUT_BYTES, 64 * 1024 * 1024);

assert.throws(
  () => normalizeInput({ bytes: Buffer.alloc(9), mime: 'image/png' }, 8),
  error => error && error.code === 'WINDOWS_OCR_INPUT_LIMIT'
);

let writes = 0;
let executions = 0;
const adapter = new WindowsOcrAdapter({
  platform: 'win32',
  maxInputBytes: 8,
  execFile: async () => {
    executions += 1;
    return { stdout: JSON.stringify({ ok: true, engine: 'Windows.Media.Ocr', text: 'unexpected' }) };
  },
  fsPromises: {
    async writeFile() { writes += 1; },
    async unlink() {}
  }
});

(async () => {
  await assert.rejects(
    () => adapter.recognize({ bytes: Buffer.alloc(9), mime: 'image/png' }),
    error => error && error.code === 'WINDOWS_OCR_INPUT_LIMIT'
  );
  assert.strictEqual(writes, 0, 'oversized OCR input must fail before temporary-file persistence');
  assert.strictEqual(executions, 0, 'oversized OCR input must fail before PowerShell execution');

  const normalized = normalizeInput({ bytes: Buffer.from([1, 2, 3]), mime: 'IMAGE/PNG' }, 8);
  assert.strictEqual(normalized.mime, 'image/png');
  assert.deepStrictEqual([...normalized.bytes], [1, 2, 3]);

  console.log(JSON.stringify({ ok: true, inputBudget: 8, failClosedBeforeWrite: true, failClosedBeforeExecution: true }));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
