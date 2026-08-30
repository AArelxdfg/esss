'use strict';

const assert = require('assert');
const {
  ToolExecutionGuard,
  fingerprint,
  observationVerifiesDebt
} = require('../src/tool-surface');

// A scoped material action must not be discharged by an unrelated observation
// merely because the planner copied the correct material fingerprint onto it.
{
  const guard = new ToolExecutionGuard();
  const material = guard.record('write_file', {path:'C:\\LLera\\state.json', content:'x'}, {ok:true});
  assert.strictEqual(material.recorded, true);
  assert.ok(guard.verificationDebt);

  const unrelated = guard.record('system_info', {}, {
    ok:true,
    verification:true,
    verifiesFingerprint: material.fingerprint
  });
  assert.strictEqual(unrelated.recorded, true);
  assert.ok(guard.verificationDebt, 'unrelated observation must not clear scoped debt');
  assert.strictEqual(guard.canFinalize(), false);

  const sameTarget = guard.record('hash_file', {path:'C:\\LLera\\state.json'}, {
    ok:true,
    verification:true,
    verifiesFingerprint: material.fingerprint
  });
  assert.strictEqual(sameTarget.recorded, true);
  assert.strictEqual(guard.verificationDebt, null);
  assert.strictEqual(guard.canFinalize(), true);
}

// An explicit fingerprint for a different action must not clear even same-scope debt.
{
  const debt = {
    fingerprint: fingerprint('delete_path', {path:'C:\\LLera\\obsolete.bin'}),
    tool: 'delete_path',
    scope: 'path:c:/llera/obsolete.bin'
  };
  const entry = {
    tool: 'path_exists',
    args: {path:'C:\\LLera\\obsolete.bin'},
    observation: true,
    material: false,
    ok: true,
    verifiesFingerprint: '0'.repeat(64)
  };
  assert.strictEqual(observationVerifiesDebt(entry, debt), false);
}

// Unscoped material debt still requires an exact explicit fingerprint binding.
{
  const guard = new ToolExecutionGuard();
  const material = guard.record('run_command', {command:'echo LLera'}, {ok:true});
  assert.ok(guard.verificationDebt);
  guard.record('system_info', {}, {ok:true, verification:true});
  assert.ok(guard.verificationDebt, 'generic observation must not clear unscoped debt');
  guard.record('system_info', {}, {ok:true, verification:true, verifiesFingerprint:material.fingerprint});
  assert.strictEqual(guard.verificationDebt, null);
}

console.log('SCOPED_VERIFICATION_FINGERPRINT_BYPASS_GUARD_PASS');
