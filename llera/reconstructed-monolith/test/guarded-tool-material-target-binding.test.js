'use strict';

const assert = require('node:assert');
const { executionSucceeded } = require('../src/guarded-tool-broker');

for (const tool of ['write_file','apply_patch','make_dir','delete_path']) {
  assert.strictEqual(
    executionSucceeded(tool, { ok:true, target:'workspace/other.txt' }, {
      material:true,
      args:{ path:'workspace/requested.txt' }
    }),
    false,
    `${tool} must reject an acknowledgement bound to a different path`
  );

  assert.strictEqual(
    executionSucceeded(tool, { ok:true, target:'WORKSPACE\\requested.txt' }, {
      material:true,
      args:{ path:'workspace/requested.txt' }
    }),
    true,
    `${tool} must accept a path-equivalent acknowledgement`
  );
}

assert.strictEqual(
  executionSucceeded('write_file', { status:'written', outputPath:'workspace/requested.txt/' }, {
    material:true,
    args:{ filePath:'workspace\\requested.txt' }
  }),
  true,
  'path aliases and separators must normalize before target binding'
);

assert.strictEqual(
  executionSucceeded('write_file', { ok:true, target:'workspace/requested.txt' }, {
    material:true,
    args:{}
  }),
  true,
  'historical path-less caller remains compatible when there is no requested target to bind'
);

assert.strictEqual(
  executionSucceeded('run_command', { ok:true, target:'shell' }, {
    material:true,
    args:{ command:'echo ok' }
  }),
  true,
  'non-path material tools retain their existing acknowledgement semantics'
);

console.log('Guarded material-action target binding contract PASS');
