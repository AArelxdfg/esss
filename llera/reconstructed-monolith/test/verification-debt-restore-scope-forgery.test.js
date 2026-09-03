'use strict';

const assert = require('node:assert/strict');
const {
  ToolExecutionGuard,
  fingerprint,
  verificationScope,
} = require('../src/tool-surface');

const materialArgs = {
  path: 'C:\\workspace\\real.txt',
  content: 'MONOLITH TEST',
};
const materialFingerprint = fingerprint('write_file', materialArgs);

const guard = new ToolExecutionGuard();
const restored = guard.restore([
  {
    tool: 'write_file',
    args: materialArgs,
    fingerprint: materialFingerprint,
    ok: true,
    scope: 'path:c:/workspace/real.txt',
  },
  {
    tool: 'read_file',
    args: { path: 'C:\\workspace\\other.txt' },
    ok: true,
    // A persisted trace can be tampered with. This forged scope must never be
    // trusted over the canonical scope derived from the executable tool args.
    scope: 'path:c:/workspace/real.txt',
  },
]);

assert.deepEqual(restored.verificationDebt, {
  fingerprint: materialFingerprint,
  tool: 'write_file',
  scope: 'path:c:/workspace/real.txt',
  at: null,
});
assert.equal(guard.canFinalize(), false);
assert.equal(
  guard.history[1].scope,
  verificationScope('read_file', { path: 'C:\\workspace\\other.txt' })
);
assert.equal(guard.history[1].scope, 'path:c:/workspace/other.txt');
assert.equal(guard.history[1].verifies, undefined);

const realObservation = guard.record(
  'read_file',
  { path: 'C:\\workspace\\real.txt' },
  { ok: true, resultSummary: 'MONOLITH TEST' }
);
assert.equal(realObservation.recorded, true);
assert.equal(realObservation.verifies, materialFingerprint);
assert.equal(guard.canFinalize(), true);
assert.equal(guard.verificationDebt, null);

console.log(JSON.stringify({
  restoredForgedScopeRejected: true,
  canonicalScopeRecomputed: true,
  debtRemainsOpenUntilRealObservation: true,
}));
