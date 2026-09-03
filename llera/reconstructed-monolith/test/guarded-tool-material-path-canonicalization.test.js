'use strict';

const assert = require('node:assert');
const { executionSucceeded } = require('../src/guarded-tool-broker');

const material = true;

assert.strictEqual(
  executionSucceeded('write_file', { ok:true, target:'WORKSPACE\\dir\\..\\requested.txt' }, {
    material,
    args:{ path:'workspace/requested.txt' }
  }),
  true,
  'Windows dot segments must canonicalize before acknowledgement binding'
);

assert.strictEqual(
  executionSucceeded('write_file', { ok:true, target:'workspace\\.\\requested.txt\\' }, {
    material,
    args:{ filePath:'WORKSPACE/requested.txt' }
  }),
  true,
  'separator, case, current-directory and trailing-separator variants must remain path-equivalent'
);

assert.strictEqual(
  executionSucceeded('write_file', { ok:true, target:'workspace\\safe\\..\\other.txt' }, {
    material,
    args:{ path:'workspace/requested.txt' }
  }),
  false,
  'canonicalization must not allow a different final target to satisfy the material action'
);

assert.strictEqual(
  executionSucceeded('delete_path', { status:'deleted', path:'C:\\LLera\\workspace\\artifact.bin' }, {
    material,
    args:{ path:'c:/llera/workspace/artifact.bin' }
  }),
  true,
  'absolute Windows drive paths must compare case-insensitively after normalization'
);

assert.strictEqual(
  executionSucceeded('delete_path', { status:'deleted', path:'D:\\LLera\\workspace\\artifact.bin' }, {
    material,
    args:{ path:'C:\\LLera\\workspace\\artifact.bin' }
  }),
  false,
  'different drive roots must remain distinct after canonicalization'
);

console.log('Guarded material-action path canonicalization contract PASS');
