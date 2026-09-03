'use strict';

const assert = require('node:assert/strict');
const { ToolExecutionGuard, fingerprint } = require('../src/tool-surface');

// Persisted verification relationships are not authoritative after restart.
// A tampered observation must not clear a material action merely by claiming
// an exact material fingerprint for an unrelated target.
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
    ok: true,
    fingerprint: materialFingerprint,
  },
  {
    tool: 'read_file',
    args: { path: 'C:\\workspace\\forged.txt' },
    ok: true,
    verifiesFingerprint: materialFingerprint,
    verifies: materialFingerprint,
    verificationOf: materialFingerprint,
    materialFingerprint,
  },
]);

assert.equal(restored.restored, 2);
assert.deepEqual(restored.verificationDebt, {
  fingerprint: materialFingerprint,
  tool: 'write_file',
  scope: 'path:c:/workspace/real.txt',
  at: null,
});
assert.equal(guard.canFinalize(), false);
assert.equal(guard.history[1].verifiesFingerprint, null);
assert.equal(guard.history[1].verifies, null);
assert.equal(guard.history[1].verificationOf, null);
assert.equal(guard.history[1].materialFingerprint, null);

// A canonical observation of the real target still clears the debt.
const realObservation = guard.record(
  'read_file',
  { path: 'C:\\workspace\\real.txt' },
  { ok: true, resultSummary: 'MONOLITH TEST' }
);
assert.equal(realObservation.recorded, true);
assert.equal(realObservation.verifies, materialFingerprint);
assert.equal(guard.canFinalize(), true);

// Fail closed for unscoped material actions too: a persisted explicit binding
// alone cannot prove that a generic observation verified a command side effect.
const commandArgs = { command: 'echo MONOLITH TEST' };
const commandFingerprint = fingerprint('run_command', commandArgs);
const unscoped = new ToolExecutionGuard();
const unscopedRestore = unscoped.restore([
  { tool: 'run_command', args: commandArgs, ok: true },
  {
    tool: 'system_info',
    args: {},
    ok: true,
    verifiesFingerprint: commandFingerprint,
  },
]);
assert.deepEqual(unscopedRestore.verificationDebt, {
  fingerprint: commandFingerprint,
  tool: 'run_command',
  scope: null,
  at: null,
});
assert.equal(unscoped.canFinalize(), false);

console.log(JSON.stringify({
  forgedPersistedBindingIgnored: true,
  canonicalScopeReobservationClearsDebt: true,
  unscopedDebtFailsClosedAfterRestart: true,
}));
