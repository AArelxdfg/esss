'use strict';

const assert = require('assert');
const { EvidenceLedger } = require('../src/evidence-ledger');

const missionId = 'mission-recovery-1';
const payload = Buffer.from('verified artifact bytes');
const ledger = new EvidenceLedger({ missionId });
const entry = ledger.add({
  stepId: 'step-verify',
  tool: 'hash_file',
  kind: 'artifact',
  target: 'C:\\LLera\\artifact.bin',
  bytes: payload,
  summary: 'verified artifact'
});

const exported = ledger.export();
assert.strictEqual(exported.length, 1);

const restored = new EvidenceLedger({ missionId });
assert.deepStrictEqual(restored.import(exported), { restored: 1 });
assert.deepStrictEqual(restored.snapshot(), exported, 'valid recovery evidence must round-trip exactly');
assert.strictEqual(restored.verifyBinding(entry.id, {
  tool: 'hash_file',
  target: 'C:\\LLera\\artifact.bin',
  bytes: payload
}).ok, true);

// Import must fail closed when the cryptographic identity no longer matches the target.
const forgedTarget = JSON.parse(JSON.stringify(exported));
forgedTarget[0].target = 'C:\\LLera\\other.bin';
assert.throws(() => restored.import(forgedTarget), /evidence id binding mismatch/);
assert.deepStrictEqual(restored.snapshot(), exported, 'failed import must be atomic and preserve the previous ledger');

// Cross-mission replay must never be accepted.
const crossMission = JSON.parse(JSON.stringify(exported));
crossMission[0].missionId = 'mission-other';
assert.throws(() => restored.import(crossMission), /evidence mission mismatch/);
assert.deepStrictEqual(restored.snapshot(), exported);

// Duplicate IDs are rejected rather than silently collapsing recovery history.
const duplicate = [exported[0], JSON.parse(JSON.stringify(exported[0]))];
assert.throws(() => restored.import(duplicate), /duplicate evidence id/);
assert.deepStrictEqual(restored.snapshot(), exported);

console.log('evidence ledger recovery import PASS', {
  exportImportRoundTrip: true,
  targetBindingFailClosed: true,
  crossMissionReplayRejected: true,
  duplicateIdentityRejected: true,
  failedImportAtomic: true
});
