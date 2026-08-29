'use strict';

const assert = require('assert');
const {
  ToolExecutionGuard,
  INDEPENDENT_VERIFICATION_TOOLS,
  fingerprint
} = require('../src/tool-surface');

assert.strictEqual(INDEPENDENT_VERIFICATION_TOOLS.has('evidence_record'), false, 'evidence_record must not count as independent verification');
assert.strictEqual(INDEPENDENT_VERIFICATION_TOOLS.has('evidence_verify'), true, 'evidence_verify is an independent verifier');

// Scoped material action: recording evidence for the same target must not discharge debt.
const scoped = new ToolExecutionGuard();
const write = scoped.record('write_file', { path:'C:\\Work\\artifact.bin', text:'payload' }, { ok:true });
assert.strictEqual(scoped.canFinalize(), false);
const recorded = scoped.record('evidence_record', { path:'C:/Work/artifact.bin', evidenceId:'EV-1' }, {
  ok:true,
  verification:true,
  verifiesFingerprint:write.fingerprint
});
assert.strictEqual(recorded.recorded, true);
assert.strictEqual(scoped.canFinalize(), false, 'provenance record cannot prove the material side effect');

const hashed = scoped.record('hash_file', { path:'C:/Work/artifact.bin' }, { ok:true });
assert.strictEqual(scoped.canFinalize(), true, 'independent same-target observation must discharge scoped debt');
assert.strictEqual(hashed.verifies, write.fingerprint);

// Unscoped material action: generic verification=true must not discharge debt.
const unscoped = new ToolExecutionGuard();
const command = unscoped.record('run_command', { command:'echo hello' }, { ok:true });
assert.strictEqual(command.scope, null);
unscoped.record('system_info', {}, { ok:true, verification:true });
assert.strictEqual(unscoped.canFinalize(), false, 'unscoped material action requires explicit fingerprint binding');
unscoped.record('system_info', {}, { ok:true, verifiesFingerprint:command.fingerprint });
assert.strictEqual(unscoped.canFinalize(), true, 'explicit independent binding may discharge unscoped debt');

// Restore path must enforce the same rule and reject persisted self-asserted evidence records.
const persistedFp = fingerprint('run_command', { command:'echo persisted' });
const restored = new ToolExecutionGuard();
restored.restore([
  { tool:'run_command', arguments:{ command:'echo persisted' }, argumentsHash:persistedFp, outcome:'success', material:true },
  { tool:'evidence_record', arguments:{ evidenceId:'EV-2' }, outcome:'verified', verification:true, verifiesFingerprint:persistedFp },
  { tool:'system_info', arguments:{}, outcome:'verified', verification:true }
]);
assert.strictEqual(restored.canFinalize(), false, 'restore must preserve debt when only assertions/generic verification exist');
restored.record('llera_doctor', {}, { ok:true, verifiesFingerprint:persistedFp });
assert.strictEqual(restored.canFinalize(), true);

console.log('independent verification debt PASS', {
  evidenceRecordCannotVerify:true,
  scopedIndependentObservation:true,
  unscopedExplicitBindingRequired:true,
  restartRulePreserved:true
});
