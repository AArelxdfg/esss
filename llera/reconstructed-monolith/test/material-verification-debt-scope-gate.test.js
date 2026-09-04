'use strict';

const assert = require('node:assert');
const { ToolExecutionGuard } = require('../src/tool-surface');

const guard = new ToolExecutionGuard({ maxSameFailure: 2 });
const target = 'C:\\LLera\\workspace\\mission.txt';
const other = 'C:\\LLera\\workspace\\other.txt';

const writeDecision = guard.decide('write_file', { path: target, content: 'MONOLITH TEST' });
assert.strictEqual(writeDecision.allow, true);
assert.strictEqual(writeDecision.material, true);

const writeTrace = guard.record('write_file', { path: target, content: 'MONOLITH TEST' }, {
  ok: true,
  resultSummary: 'written'
});
assert.strictEqual(writeTrace.recorded, true);
assert.ok(guard.verificationDebt, 'successful material action must open verification debt');
assert.strictEqual(guard.canFinalize(), false);

const secondMaterial = guard.decide('delete_path', { path: other });
assert.strictEqual(secondMaterial.allow, false);
assert.strictEqual(secondMaterial.reason, 'verification_debt_open');

const wrongScopeObservation = guard.record('read_file', { path: other }, {
  ok: true,
  resultSummary: 'observed different target',
  verification: true,
  verifiesFingerprint: writeTrace.fingerprint
});
assert.strictEqual(wrongScopeObservation.recorded, true);
assert.ok(guard.verificationDebt, 'wrong-scope observation must not clear material verification debt');
assert.strictEqual(guard.canFinalize(), false);

const sameScopeObservation = guard.record('read_file', { path: target }, {
  ok: true,
  resultSummary: 'MONOLITH TEST',
  verification: true
});
assert.strictEqual(sameScopeObservation.recorded, true);
assert.strictEqual(sameScopeObservation.verifies, writeTrace.fingerprint);
assert.strictEqual(guard.verificationDebt, null);
assert.strictEqual(guard.canFinalize(), true);

const retrySameMaterial = guard.decide('write_file', { path: target, content: 'MONOLITH TEST' });
assert.strictEqual(retrySameMaterial.allow, false);
assert.strictEqual(retrySameMaterial.reason, 'anti_loop_recent_success');

const restored = new ToolExecutionGuard();
restored.restore([
  {
    tool: 'write_file',
    args: { path: target, content: 'MONOLITH TEST' },
    ok: true,
    verifiesFingerprint: 'forged',
    verifiedBy: 'forged'
  },
  {
    tool: 'read_file',
    args: { path: other },
    ok: true,
    verification: true,
    verifiesFingerprint: writeTrace.fingerprint
  }
]);
assert.ok(restored.verificationDebt, 'forged persisted verification binding must not clear wrong-scope debt');
assert.strictEqual(restored.canFinalize(), false);

console.log('material verification debt scope gate regression PASS');
