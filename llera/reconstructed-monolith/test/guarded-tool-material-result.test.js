'use strict';

const assert = require('node:assert');
const { executionSucceeded } = require('../src/guarded-tool-broker');

for (const result of [undefined, null, false, true, 0, 1, 'done']) {
  assert.strictEqual(
    executionSucceeded('write_file', result, { material:true }),
    false,
    `material action primitive ${String(result)} must fail closed`
  );
}

assert.strictEqual(
  executionSucceeded('write_file', { ok:true, status:'success', target:'workspace/file.txt' }, { material:true }),
  true,
  'structured successful material action acknowledgement must remain accepted'
);
assert.strictEqual(
  executionSucceeded('read_file', 'legacy-text-result', { material:false }),
  true,
  'non-material historical primitive results remain backwards compatible'
);

console.log('Guarded material-action result semantics PASS', {
  primitivesFailClosedForMaterial:true,
  structuredMaterialSuccessAccepted:true,
  nonMaterialPrimitiveCompatibility:true
});
