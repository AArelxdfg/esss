'use strict';

const assert = require('node:assert');
const { executionSucceeded } = require('../src/guarded-tool-broker');

for (const result of [
  {},
  { target:'workspace/file.txt' },
  { ok:true },
  { status:'success' },
  { success:true, target:'   ' },
  { ok:true, target:null }
]) {
  assert.strictEqual(
    executionSucceeded('write_file', result, { material:true }),
    false,
    `ambiguous material acknowledgement must fail closed: ${JSON.stringify(result)}`
  );
}

for (const result of [
  { ok:true, target:'workspace/file.txt' },
  { success:true, path:'workspace/file.txt' },
  { status:'written', filePath:'workspace/file.txt' },
  { state:'completed', destination:'workspace/file.txt' },
  { status:'created', outputPath:'workspace/file.txt' }
]) {
  assert.strictEqual(
    executionSucceeded('write_file', result, { material:true }),
    true,
    `explicit material acknowledgement must be accepted: ${JSON.stringify(result)}`
  );
}

assert.strictEqual(
  executionSucceeded('read_file', {}, { material:false }),
  true,
  'non-material structured historical result remains backwards compatible'
);

console.log('Guarded material-action explicit acknowledgement contract PASS');
