'use strict';

const assert = require('node:assert/strict');
const { FailureDoctrine, stableFingerprint } = require('../src/failure-doctrine');

function legacyFailure({ at, failureClass = 'strategy' }) {
  const args = { path: 'x' };
  const error = { message: 'boom' };
  return {
    missionId: 'm1',
    stepId: 's1',
    tool: 'read_file',
    argsFingerprint: stableFingerprint(args),
    failureClass,
    fingerprint: stableFingerprint({
      tool: 'read_file',
      args,
      failureClass,
      code: undefined,
      message: error.message,
    }),
    material: false,
    message: error.message,
    at,
  };
}

// Legacy unsealed history remains visible for compatibility/audit, but must
// not consume retry/strategy budget by default because its provenance cannot
// be cryptographically established.
const doctrine = new FailureDoctrine({ maxSameFailure: 2, clock: () => 100 });
const first = legacyFailure({ at: 1 });
const second = legacyFailure({ at: 2 });
const restored = doctrine.restore([
  { ok: false, failure: first },
  { ok: false, failure: second },
]);
assert.deepEqual(restored, { restored: 2, legacyUnsealed: 2, rejected: 0 });
assert.equal(doctrine.history.length, 2);
assert.equal(doctrine.history.every((event) => event.restoredLegacy === true), true);

const live = doctrine.recordFailure({
  missionId: 'm1',
  stepId: 's1',
  tool: 'read_file',
  args: { path: 'x' },
  error: { message: 'boom' },
});
assert.equal(live.decision.action, 'retry-once');
assert.equal(live.decision.retry, true);

// A freshly sealed failure still consumes the normal strategy budget.
const live2 = doctrine.recordFailure({
  missionId: 'm1',
  stepId: 's1',
  tool: 'read_file',
  args: { path: 'x' },
  error: { message: 'boom' },
});
assert.equal(live2.decision.action, 'change-strategy');
assert.equal(live2.decision.retry, false);

// Explicit compatibility mode can opt into the historical behavior when a
// caller has independently established trust in the legacy trace source.
const trustedLegacy = new FailureDoctrine({ maxSameFailure: 2, trustLegacyRestored: true, clock: () => 100 });
trustedLegacy.restore([
  { ok: false, failure: first },
  { ok: false, failure: second },
]);
const trustedDecision = trustedLegacy.recordFailure({
  missionId: 'm1',
  stepId: 's1',
  tool: 'read_file',
  args: { path: 'x' },
  error: { message: 'boom' },
});
assert.equal(trustedDecision.decision.action, 'change-strategy');
assert.equal(trustedDecision.decision.retry, false);

console.log('MONOLITH failure doctrine legacy trust boundary PASS', {
  legacyHistoryPreserved: true,
  unsealedLegacyExcludedFromDecisionsByDefault: true,
  sealedLiveFailuresConsumeBudget: true,
  explicitLegacyTrustOptIn: true,
});
