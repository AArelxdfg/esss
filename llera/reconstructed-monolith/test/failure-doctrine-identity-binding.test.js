'use strict';

const assert = require('node:assert/strict');
const {
  FailureDoctrine,
  stableFingerprint,
  failureEventSeal,
  structurallyValidFailure,
  validBoundIdentity,
} = require('../src/failure-doctrine');

for (const value of [null, undefined, '', '   ', 7, true, {}, [], () => {}]) {
  assert.equal(validBoundIdentity(value), false, `identity should fail closed: ${String(value)}`);
}
assert.equal(validBoundIdentity('mission-1'), true);
assert.equal(validBoundIdentity(' step-1 '), true);

for (const field of ['missionId', 'stepId', 'tool']) {
  const doctrine = new FailureDoctrine({ clock:() => 1700000000000 });
  const input = {
    missionId:'mission-1',
    stepId:'step-1',
    tool:'read_file',
    args:{path:'x'},
    error:new Error('boom'),
  };
  input[field] = { forged:true };
  assert.throws(() => doctrine.recordFailure(input), /must be non-empty strings/);
  assert.equal(doctrine.history.length, 0, 'invalid live identity must not mutate history');
}

const base = {
  missionId:'mission-1',
  stepId:'step-1',
  tool:'read_file',
  argsFingerprint:stableFingerprint({path:'x'}),
  failureClass:'strategy',
  fingerprint:stableFingerprint({failure:'x'}),
  material:false,
  message:'boom',
  at:1700000000000,
};

for (const field of ['missionId', 'stepId', 'tool']) {
  for (const forged of [{toString:() => base[field]}, [base[field]], 42, true, '   ']) {
    const failure = {...base, [field]:forged};
    failure.eventSeal = failureEventSeal(failure);
    assert.equal(structurallyValidFailure(failure), false, `${field} type confusion must fail closed`);
    const doctrine = new FailureDoctrine();
    const result = doctrine.restore([{ok:false, failure}]);
    assert.deepEqual(result, {restored:0, legacyUnsealed:0, rejected:1});
    assert.equal(doctrine.history.length, 0, 'forged persisted identity must not enter doctrine history');
  }
}

const good = {...base};
good.eventSeal = failureEventSeal(good);
const doctrine = new FailureDoctrine();
assert.deepEqual(doctrine.restore([{ok:false, failure:good}]), {restored:1, legacyUnsealed:0, rejected:0});
assert.equal(doctrine.history.length, 1);
assert.equal(doctrine.history[0].missionId, 'mission-1');
assert.equal(doctrine.history[0].stepId, 'step-1');
assert.equal(doctrine.history[0].tool, 'read_file');

console.log('MONOLITH failure doctrine identity binding regression PASS', {
  liveIdentityTypeBound:true,
  persistedIdentityTypeBound:true,
  forgedStringCoercionRejected:true,
  validRestorePreserved:true,
});
