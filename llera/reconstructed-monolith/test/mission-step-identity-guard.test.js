'use strict';

const assert = require('assert');
const { missionStepIdentityReport, assertMissionStepIdentity } = require('../src/mission-step-identity-guard');

const clean = missionStepIdentityReport([{ id: 'scope' }, { id: 'verify' }]);
assert.strictEqual(clean.ok, true);
assert.strictEqual(clean.code, 'MISSION_STEP_IDENTITY_OK');

const duplicate = missionStepIdentityReport([{ id: 'scope' }, { id: 'scope' }, { id: 'verify' }]);
assert.strictEqual(duplicate.ok, false);
assert.strictEqual(duplicate.code, 'MISSION_STEP_ID_COLLISION');
assert.deepStrictEqual(duplicate.duplicates, ['scope']);

assert.throws(
  () => assertMissionStepIdentity([{ id: 'scope' }, { id: 'scope' }]),
  error => error && error.code === 'MISSION_STEP_ID_COLLISION'
);

const invalid = missionStepIdentityReport([{ id: 'scope' }, { id: '' }, {}]);
assert.strictEqual(invalid.ok, false);
assert.strictEqual(invalid.code, 'MISSION_STEP_ID_INVALID');
assert.deepStrictEqual(invalid.invalidIds, [1, 2]);

assert.throws(
  () => assertMissionStepIdentity([]),
  error => error && error.code === 'MISSION_STEPS_REQUIRED'
);

console.log('MISSION_STEP_IDENTITY_GUARD_PASS');
