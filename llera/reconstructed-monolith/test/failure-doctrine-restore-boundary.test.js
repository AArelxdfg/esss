'use strict';

const assert = require('assert');
const {
  FailureDoctrine,
  FAILURE_CLASS,
  stableFingerprint,
  failureEventSeal,
} = require('../src/failure-doctrine');

function validFailure(overrides = {}) {
  const event = {
    missionId:'mission-restore-boundary',
    stepId:'step-1',
    tool:'filesystem.read',
    argsFingerprint:stableFingerprint({path:'C:/LLera/test.txt'}),
    failureClass:FAILURE_CLASS.TRANSIENT,
    fingerprint:stableFingerprint({tool:'filesystem.read', reason:'timeout'}),
    material:false,
    message:'temporary timeout',
    at:1700000000000,
    ...overrides,
  };
  if (!Object.prototype.hasOwnProperty.call(overrides, 'eventSeal')) {
    event.eventSeal = failureEventSeal(event);
  }
  return event;
}

const doctrine = new FailureDoctrine();

const valid = validFailure();
let diagnostics = doctrine.restore([{ok:false, failure:valid}]);
assert.deepStrictEqual(diagnostics, {restored:1, legacyUnsealed:0, rejected:0});
assert.strictEqual(doctrine.history.length, 1);

let coercions = 0;
const coerciveMission = validFailure({
  missionId:{toString(){ coercions += 1; return 'mission-restore-boundary'; }},
});
diagnostics = doctrine.restore([{ok:false, failure:coerciveMission}]);
assert.strictEqual(diagnostics.rejected, 1);
assert.strictEqual(coercions, 0);

const coerciveTimestamp = validFailure({
  at:{valueOf(){ coercions += 1; return 1700000000000; }},
});
diagnostics = doctrine.restore([{ok:false, failure:coerciveTimestamp}]);
assert.strictEqual(diagnostics.rejected, 1);
assert.strictEqual(coercions, 0);

const coerciveSeal = validFailure({
  eventSeal:{toString(){ coercions += 1; return valid.eventSeal; }},
});
diagnostics = doctrine.restore([{ok:false, failure:coerciveSeal}]);
assert.strictEqual(diagnostics.rejected, 1);
assert.strictEqual(coercions, 0);

const wrongPrimitiveTypes = validFailure({material:1, message:['temporary timeout']});
diagnostics = doctrine.restore([{ok:false, failure:wrongPrimitiveTypes}]);
assert.strictEqual(diagnostics.rejected, 1);

const tampered = {...valid, message:'different failure'};
diagnostics = doctrine.restore([{ok:false, failure:tampered}]);
assert.strictEqual(diagnostics.rejected, 1);

const legacy = validFailure({eventSeal:null});
diagnostics = doctrine.restore([{ok:false, failure:legacy}]);
assert.deepStrictEqual(diagnostics, {restored:1, legacyUnsealed:1, rejected:0});

assert.strictEqual(coercions, 0);
console.log('MONOLITH failure doctrine restore boundary PASS', {
  validSealedRestore:true,
  coerciveMissionRejected:true,
  coerciveTimestampRejected:true,
  coerciveSealRejected:true,
  primitiveTypesRequired:true,
  tamperRejected:true,
  legacyUnsealedPreserved:true,
});
