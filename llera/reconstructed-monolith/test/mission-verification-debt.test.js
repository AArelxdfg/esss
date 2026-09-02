'use strict';

const assert = require('node:assert/strict');
const crypto = require('crypto');
const {
  deriveMissionVerificationDebt,
  missionHasVerificationDebt,
} = require('../src/mission-verification-debt');

function fp(tool, args) {
  const stable = (value) => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') {
      return Object.keys(value).sort().reduce((out, key) => {
        out[key] = stable(value[key]);
        return out;
      }, {});
    }
    return value;
  };
  return crypto.createHash('sha256').update(JSON.stringify([tool, stable(args)])).digest('hex');
}

const path = 'C:/LLera/workspace/monolith-test.txt';
const writeArgs = { path, content: 'MONOLITH TEST' };
const writeFingerprint = fp('write_file', writeArgs);

const openDebtMission = {
  id: 'mission-open-debt',
  toolTrace: [{
    id: 'trace-write',
    tool: 'write_file',
    argumentsHash: writeFingerprint,
    outcome: 'success',
    material: true,
    observation: false,
    scope: 'path:c:/llera/workspace/monolith-test.txt',
  }],
};

const debt = deriveMissionVerificationDebt(openDebtMission);
assert.ok(debt, 'successful material action must restore verification debt');
assert.equal(debt.tool, 'write_file');
assert.equal(debt.fingerprint, writeFingerprint);
assert.equal(debt.scope, 'path:c:/llera/workspace/monolith-test.txt');
assert.equal(missionHasVerificationDebt(openDebtMission), true);

const closedDebtMission = {
  ...openDebtMission,
  id: 'mission-closed-debt',
  toolTrace: [
    ...openDebtMission.toolTrace,
    {
      id: 'trace-read',
      tool: 'read_file',
      argumentsHash: fp('read_file', { path }),
      outcome: 'observed',
      material: false,
      observation: true,
      verification: true,
      scope: 'path:c:/llera/workspace/monolith-test.txt',
      verifiesFingerprint: writeFingerprint,
    },
  ],
};

assert.equal(deriveMissionVerificationDebt(closedDebtMission), null, 'independently bound observation must clear restored debt');
assert.equal(missionHasVerificationDebt(closedDebtMission), false);

const forgedMetadataMission = {
  id: 'mission-forged-metadata',
  verificationDebtOpen: false,
  verificationDebt: null,
  toolTrace: openDebtMission.toolTrace,
};
assert.equal(missionHasVerificationDebt(forgedMetadataMission), true, 'durable canonical tool trace must override forged/absent UI debt metadata');

console.log('Mission durable verification debt derivation PASS', {
  openMaterialDebtRestored: true,
  boundObservationClosesDebt: true,
  uiMetadataCannotHideDebt: true,
});
