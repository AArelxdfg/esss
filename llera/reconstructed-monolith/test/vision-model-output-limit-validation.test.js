'use strict';

const assert = require('assert');
const { normalizeVisionOutput } = require('../src/vision-pipeline');

const invalidBudgets = [
  ['maxDepth', Infinity],
  ['maxNodes', 0],
  ['maxStringBytes', -1],
  ['maxTotalStringBytes', 1.5],
  ['maxKeyBytes', '4096'],
];

for (const [key, value] of invalidBudgets) {
  assert.throws(
    () => normalizeVisionOutput({ ok: true }, { [key]: value }),
    (error) => error
      && error.code === 'VISION_MODEL_OUTPUT_LIMIT_INVALID'
      && /positive safe integer/.test(error.message),
    `${key} must fail closed for invalid budget ${String(value)}`,
  );
}

const valid = normalizeVisionOutput(
  { caption: 'MONOLITH', nested: [1, true, null] },
  {
    maxDepth: 4,
    maxNodes: 8,
    maxStringBytes: 32,
    maxTotalStringBytes: 64,
    maxKeyBytes: 32,
  },
);

assert.strictEqual(valid.caption, 'MONOLITH');
assert.deepStrictEqual(valid.nested, [1, true, null]);

console.log('vision model output limit validation regression: ok');
