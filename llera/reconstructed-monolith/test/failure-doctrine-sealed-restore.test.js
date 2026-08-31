'use strict';

const assert = require('node:assert/strict');
const {
  FailureDoctrine,
  stableFingerprint,
  failureEventSeal
} = require('../src/failure-doctrine');

const doctrine = new FailureDoctrine({ clock: () => 1700000000000 });
const recorded = doctrine.recordFailure({
  missionId:'m1',
  stepId:'s1',
  tool:'web_get',
  args:{url:'https://example.test'},
  error:{code:'ETIMEDOUT', message:'timed out'}
});

assert.match(recorded.eventSeal, /^[a-f0-9]{64}$/);
assert.equal(recorded.eventSeal, failureEventSeal(recorded));

const cleanRestore = new FailureDoctrine();
let d = cleanRestore.restore([{ ok:false, failure:recorded }]);
assert.deepEqual(d, {restored:1, legacyUnsealed:0, rejected:0});
assert.equal(cleanRestore.history.length, 1);

// Replaying the same persisted trace during repeated restart/recovery must not
// inflate doctrine history or consume retry budget twice.
d = cleanRestore.restore([{ ok:false, failure:recorded }]);
assert.deepEqual(d, {restored:0, legacyUnsealed:0, rejected:0});
assert.equal(cleanRestore.history.length, 1);
assert.equal(cleanRestore.summarize('m1').total, 1);

// Duplicate entries inside one persisted trace are equally idempotent.
const duplicateBatch = new FailureDoctrine();
d = duplicateBatch.restore([
  { ok:false, failure:recorded },
  { ok:false, failure:recorded }
]);
assert.deepEqual(d, {restored:1, legacyUnsealed:0, rejected:0});
assert.equal(duplicateBatch.history.length, 1);

const tamperedClass = { ...recorded, failureClass:'integrity' };
const tamperedRestore = new FailureDoctrine();
d = tamperedRestore.restore([{ ok:false, failure:tamperedClass }]);
assert.deepEqual(d, {restored:0, legacyUnsealed:0, rejected:1});
assert.equal(tamperedRestore.history.length, 0);

const tamperedMaterial = { ...recorded, material:true };
const materialRestore = new FailureDoctrine();
d = materialRestore.restore([{ ok:false, failure:tamperedMaterial }]);
assert.equal(d.rejected, 1);
assert.equal(materialRestore.history.length, 0);

const fabricated = new FailureDoctrine();
d = fabricated.restore([{ok:false, failure:{
  missionId:'m1', stepId:'s1', tool:'x', failureClass:'strategy',
  argsFingerprint:'not-a-hash', fingerprint:'also-bad', at:123
}}]);
assert.equal(d.rejected, 1);
assert.equal(fabricated.history.length, 0);

const legacy = {
  missionId:'legacy-m', stepId:'legacy-s', tool:'read_file',
  argsFingerprint:stableFingerprint({path:'x'}),
  failureClass:'strategy',
  fingerprint:stableFingerprint({legacy:true}),
  material:false, message:'legacy failure', at:42
};
const legacyRestore = new FailureDoctrine();
d = legacyRestore.restore([{ok:false, failure:legacy}]);
assert.deepEqual(d, {restored:1, legacyUnsealed:1, rejected:0});
assert.equal(legacyRestore.history[0].eventSeal, null);

// Legacy traces have no eventSeal, so identity is derived from their complete
// normalized failure tuple and must still be replay-safe.
d = legacyRestore.restore([{ok:false, failure:legacy}]);
assert.deepEqual(d, {restored:0, legacyUnsealed:1, rejected:0});
assert.equal(legacyRestore.history.length, 1);

console.log('MONOLITH failure doctrine sealed restore PASS', {
  sealedEventRestored:true,
  repeatedRestoreIdempotent:true,
  duplicateBatchIdempotent:true,
  retryDecisionTamperRejected:true,
  malformedTraceRejected:true,
  legacyTraceCompatibility:true,
  legacyRestoreIdempotent:true,
  legacyTrustDebtSurfaced:true
});
