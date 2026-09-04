'use strict';

const assert = require('node:assert/strict');
const {
  FailureDoctrine,
  MAX_RESTORE_TRACE_ITEMS,
  stableFingerprint,
  failureEventSeal,
} = require('../src/failure-doctrine');

function sealedFailure({ missionId='m', stepId='s', tool='read_file', at=1700000000000 } = {}) {
  const failure = {
    missionId,
    stepId,
    tool,
    argsFingerprint: stableFingerprint({ path:'x' }),
    failureClass: 'strategy',
    fingerprint: stableFingerprint({ failure:'boom' }),
    material: false,
    message: 'boom',
    at,
  };
  failure.eventSeal = failureEventSeal(failure);
  return failure;
}

{
  const doctrine = new FailureDoctrine();
  const before = doctrine.history.length;
  const diagnostics = doctrine.restore({ 0:{ ok:false, failure:sealedFailure() }, length:1 });
  assert.deepEqual(diagnostics, { restored:0, legacyUnsealed:0, rejected:1 });
  assert.equal(doctrine.history.length, before, 'non-array restore input must not mutate history');
}

{
  const doctrine = new FailureDoctrine();
  const oversized = new Array(MAX_RESTORE_TRACE_ITEMS + 1).fill(null);
  oversized[0] = { ok:false, failure:sealedFailure() };
  const diagnostics = doctrine.restore(oversized);
  assert.deepEqual(diagnostics, {
    restored:0,
    legacyUnsealed:0,
    rejected:MAX_RESTORE_TRACE_ITEMS + 1,
  });
  assert.equal(doctrine.history.length, 0, 'oversized trace must fail closed before partial restore');
}

{
  const doctrine = new FailureDoctrine();
  const trace = new Array(MAX_RESTORE_TRACE_ITEMS).fill(null);
  trace[0] = { ok:false, failure:sealedFailure() };
  const diagnostics = doctrine.restore(trace);
  assert.deepEqual(diagnostics, { restored:1, legacyUnsealed:0, rejected:0 });
  assert.equal(doctrine.history.length, 1, 'bounded trace must preserve valid restore behavior');
}

console.log('MONOLITH failure doctrine restore budget PASS', {
  nonArrayFailClosed:true,
  oversizedFailClosed:true,
  noPartialMutation:true,
  boundedRestorePreserved:true,
  maxRestoreTraceItems:MAX_RESTORE_TRACE_ITEMS,
});
