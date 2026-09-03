'use strict';

const assert = require('node:assert/strict');
const {
  ToolExecutionGuard,
  fingerprint,
  semanticFingerprint,
} = require('../src/tool-surface');

const materialArgs = {
  path: 'C:\\workspace\\real.txt',
  content: 'MONOLITH TEST',
};
const forgedExact = 'f'.repeat(64);
const forgedSemantic = 'e'.repeat(64);
const canonicalExact = fingerprint('write_file', materialArgs);
const canonicalSemantic = semanticFingerprint('write_file', materialArgs);

assert.notEqual(forgedExact, canonicalExact);
assert.notEqual(forgedSemantic, canonicalSemantic);

const guard = new ToolExecutionGuard();
const restored = guard.restore([
  {
    tool: 'write_file',
    args: materialArgs,
    ok: true,
    fingerprint: forgedExact,
    semanticFingerprint: forgedSemantic,
    scope: 'path:c:/workspace/forged.txt',
  },
]);

assert.equal(restored.restored, 1);
assert.deepEqual(restored.verificationDebt, {
  fingerprint: canonicalExact,
  tool: 'write_file',
  scope: 'path:c:/workspace/real.txt',
  at: null,
});
assert.equal(guard.history[0].fingerprint, canonicalExact);
assert.equal(guard.history[0].semanticFingerprint, canonicalSemantic);
assert.notEqual(guard.history[0].fingerprint, forgedExact);
assert.notEqual(guard.history[0].semanticFingerprint, forgedSemantic);

// A forged persisted semantic identity must not poison anti-loop matching for an
// unrelated action after restart. The canonical semantic identity is authoritative.
const unrelated = guard.decide('read_file', { path: 'C:\\workspace\\other.txt' });
assert.equal(unrelated.allow, true);

// The real observation still clears only the canonical material debt.
const observation = guard.record(
  'read_file',
  { path: 'C:\\workspace\\real.txt' },
  { ok: true, resultSummary: 'MONOLITH TEST' }
);
assert.equal(observation.recorded, true);
assert.equal(observation.verifies, canonicalExact);
assert.equal(guard.canFinalize(), true);

console.log(JSON.stringify({
  restoredExactFingerprintRecomputed: true,
  restoredSemanticFingerprintRecomputed: true,
  forgedIdentityIgnored: true,
  canonicalDebtClearedByRealObservation: true,
}));
