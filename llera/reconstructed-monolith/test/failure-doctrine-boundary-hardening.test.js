'use strict';

const assert = require('node:assert/strict');
const {
  FailureDoctrine,
  stableFingerprint,
  failureEventSeal,
  structurallyValidFailure,
  validFailureTimestamp,
} = require('../src/failure-doctrine');

for (const value of [0, -1, 1.5, NaN, Infinity, '2', true, null]) {
  assert.throws(() => new FailureDoctrine({ maxSameFailure:value }), /positive safe integer/);
  assert.throws(() => new FailureDoctrine({ maxTransientRetries:value }), /positive safe integer/);
}
assert.throws(() => new FailureDoctrine({ clock:123 }), /clock must be a function/);

for (const value of [-1, 1.5, NaN, Infinity, '1700000000000', true, null, Number.MAX_SAFE_INTEGER + 1]) {
  assert.equal(validFailureTimestamp(value), false, `timestamp should fail closed: ${String(value)}`);
}
assert.equal(validFailureTimestamp(0), true);
assert.equal(validFailureTimestamp(1700000000000), true);

const hashes = {
  argsFingerprint:stableFingerprint({path:'x'}),
  fingerprint:stableFingerprint({failure:'x'})
};

for (const at of ['42', -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  const event = {
    missionId:'m1', stepId:'s1', tool:'read_file', failureClass:'strategy',
    ...hashes, material:false, message:'x', at
  };
  event.eventSeal = failureEventSeal(event);
  assert.equal(structurallyValidFailure(event), false);
  const doctrine = new FailureDoctrine();
  const d = doctrine.restore([{ok:false, failure:event}]);
  assert.deepEqual(d, {restored:0, legacyUnsealed:0, rejected:1});
  assert.equal(doctrine.history.length, 0);
}

for (const badClock of [() => '1700000000000', () => -1, () => 1.25, () => Infinity]) {
  const doctrine = new FailureDoctrine({clock:badClock});
  assert.throws(() => doctrine.recordFailure({
    missionId:'m', stepId:'s', tool:'read_file', args:{path:'x'}, error:new Error('boom')
  }), /FAILURE_DOCTRINE_CLOCK_INVALID/);
  assert.equal(doctrine.history.length, 0, 'invalid clock must not mutate doctrine history');
}

const good = new FailureDoctrine({maxSameFailure:2, maxTransientRetries:3, clock:() => 1700000000000});
const recorded = good.recordFailure({
  missionId:'m', stepId:'s', tool:'read_file', args:{path:'x'},
  error:Object.assign(new Error('temporary timeout'), {code:'ETIMEDOUT'})
});
assert.equal(recorded.at, 1700000000000);
assert.match(recorded.eventSeal, /^[a-f0-9]{64}$/);
assert.equal(recorded.decision.action, 'retry-backoff');

console.log('MONOLITH failure doctrine boundary hardening PASS', {
  retryBudgetsFailClosed:true,
  persistedTimestampTypeBound:true,
  unsafeTimestampRejected:true,
  invalidClockNoMutation:true,
  validBehaviorPreserved:true
});
