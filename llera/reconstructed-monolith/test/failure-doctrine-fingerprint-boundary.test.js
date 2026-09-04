'use strict';

const assert = require('assert');
const {
  FailureDoctrine,
  stableFingerprint,
} = require('../src/failure-doctrine');

const shared = { value: 'shared-node' };
assert.strictEqual(
  stableFingerprint({ left: shared, right: shared }),
  stableFingerprint({ left: { value: 'shared-node' }, right: { value: 'shared-node' } }),
  'shared references must canonicalize by value rather than masquerading as circular input'
);

const circular = { value: 'cycle' };
circular.self = circular;
assert.throws(
  () => stableFingerprint(circular),
  /circular_failure_fingerprint_input/,
  'circular fingerprint input must fail closed instead of colliding with a literal marker'
);

const doctrine = new FailureDoctrine({ clock: () => 1700000000000 });
assert.throws(
  () => doctrine.recordFailure({
    missionId: 'mission-doctrine-boundary',
    stepId: 'step-circular-args',
    tool: 'filesystem.write',
    args: circular,
    error: new Error('write failed'),
  }),
  /circular_failure_fingerprint_input/
);
assert.strictEqual(doctrine.history.length, 0, 'rejected fingerprint input must not mutate doctrine history');

const source = new FailureDoctrine({ clock: () => 1700000000001 });
const legitimate = source.recordFailure({
  missionId: 'mission-doctrine-boundary',
  stepId: 'step-restore',
  tool: 'filesystem.read',
  args: { path: 'C:/LLera/state.bin' },
  error: new Error('temporary failure'),
});

let coercions = 0;
const malformedMessage = {
  toString() {
    coercions += 1;
    throw new Error('message coercion attempted');
  },
};
const restored = new FailureDoctrine();
const diagnostics = restored.restore([{
  ok: false,
  failure: { ...legitimate, message: malformedMessage },
}]);
assert.deepStrictEqual(diagnostics, { restored: 0, legacyUnsealed: 0, rejected: 1 });
assert.strictEqual(coercions, 0, 'restore validation must reject malformed fields before coercion');
assert.strictEqual(restored.history.length, 0);

console.log('MONOLITH failure doctrine fingerprint boundary PASS', {
  sharedReferenceCanonicalizedByValue: true,
  circularFingerprintRejected: true,
  rejectedRecordLeavesHistoryClean: true,
  malformedRestoreRejectedBeforeCoercion: true,
});
