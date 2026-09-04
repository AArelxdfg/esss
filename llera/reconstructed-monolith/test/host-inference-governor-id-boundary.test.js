'use strict';

const assert = require('node:assert');
const { HostInferenceGovernor } = require('../src/host-inference-governor');

const governor = new HostInferenceGovernor({ now: () => 1234 });

for (const invalidId of [null, undefined, '', '   ', 7, true, {}, [], { toString: () => 'coerced-id' }]) {
  const result = governor.admit({ id: invalidId, className: 'interactive' });
  assert.strictEqual(result.allow, false);
  assert.strictEqual(result.reason, 'unique_inference_id_required');
}

assert.strictEqual(governor.snapshot().active.length, 0);

const controlChar = governor.admit({ id: 'chat\u0000forged', className: 'interactive' });
assert.strictEqual(controlChar.allow, false);

const oversized = governor.admit({ id: 'x'.repeat(257), className: 'interactive' });
assert.strictEqual(oversized.allow, false);

const admitted = governor.admit({ id: '  chat-safe-1  ', className: 'interactive', requestedTokens: 1024 });
assert.strictEqual(admitted.allow, true);
assert.strictEqual(admitted.id, 'chat-safe-1');
assert.strictEqual(governor.snapshot().active[0].id, 'chat-safe-1');

const duplicateCanonical = governor.admit({ id: 'chat-safe-1', className: 'interactive' });
assert.strictEqual(duplicateCanonical.allow, false);
assert.strictEqual(duplicateCanonical.reason, 'unique_inference_id_required');

assert.strictEqual(governor.complete({ toString: () => 'chat-safe-1' }), false);
assert.strictEqual(governor.snapshot().active.length, 1);
assert.strictEqual(governor.complete('  chat-safe-1  '), true);
assert.strictEqual(governor.snapshot().active.length, 0);

console.log('MONOLITH HOSTGUARD inference id boundary regression PASS');
