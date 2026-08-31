'use strict';

const assert = require('assert');
const { ToolExecutionGuard } = require('../src/tool-surface');

const target = 'C:\\Work\\artifact.bin';
const guard = new ToolExecutionGuard();

// A persisted trace must not be able to downgrade a canonical material tool or
// self-promote it into an observation after restart.
const restored = guard.restore([
  {
    tool: 'write_file',
    arguments: { path: target, text: 'payload' },
    outcome: 'success',
    material: false,
    observation: true,
    verification: true
  }
]);

assert.strictEqual(restored.restored, 1);
assert.strictEqual(guard.history[0].material, true, 'canonical write_file must remain material');
assert.strictEqual(guard.history[0].observation, false, 'canonical write_file must not become an observation from persisted metadata');
assert.strictEqual(guard.canFinalize(), false, 'restored successful write must reconstruct verification debt');
assert.strictEqual(guard.verificationDebt.tool, 'write_file');
assert.strictEqual(guard.verificationDebt.scope, 'path:c:/work/artifact.bin');

// A provenance assertion cannot clear the debt even when persisted metadata claims observation.
guard.restore([
  {
    tool: 'write_file',
    arguments: { path: target, text: 'payload' },
    outcome: 'success',
    material: false,
    observation: true
  },
  {
    tool: 'evidence_record',
    arguments: { path: target, evidenceId: 'EV-FORGED' },
    outcome: 'verified',
    observation: true,
    verification: true
  }
]);
assert.strictEqual(guard.canFinalize(), false, 'evidence_record must not discharge restored material debt');

// A real independent same-target observation can discharge the debt.
const verified = guard.record('hash_file', { path: target }, { ok: true });
assert.strictEqual(verified.recorded, true);
assert.strictEqual(guard.canFinalize(), true);

// Persisted metadata may conservatively classify an unknown historical action as
// material, but it cannot make an unknown action an observation/verifier.
const legacy = new ToolExecutionGuard();
legacy.restore([
  { tool: 'legacy_external_action', arguments: { id: 1 }, outcome: 'success', material: true, observation: true }
]);
assert.strictEqual(legacy.history[0].material, true);
assert.strictEqual(legacy.history[0].observation, false);
assert.strictEqual(legacy.canFinalize(), false, 'conservative legacy material debt must survive restart');

console.log('restored tool classification authority PASS', {
  canonicalMaterialCannotDowngrade: true,
  persistedObservationCannotSelfPromote: true,
  provenanceCannotDischargeDebt: true,
  independentTargetObservationClearsDebt: true,
  legacyMaterialRemainsConservative: true
});
