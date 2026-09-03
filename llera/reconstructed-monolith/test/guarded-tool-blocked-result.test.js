'use strict';

const assert = require('node:assert');
const { executionSucceeded } = require('../src/guarded-tool-broker');

assert.strictEqual(executionSucceeded('read_file', { blocked:true, reason:'policy' }), false,
  'explicitly blocked executor results must never be treated as successful execution');
assert.strictEqual(executionSucceeded('read_file', { status:'blocked' }), false,
  'blocked status must fail closed');
assert.strictEqual(executionSucceeded('read_file', { state:'denied' }), false,
  'denied state must fail closed');
assert.strictEqual(executionSucceeded('read_file', { ok:true, status:'success' }), true,
  'normal successful results must remain accepted');

console.log('Guarded tool blocked-result semantic gate PASS', {
  explicitBlockedFailsClosed:true,
  blockedStatusFailsClosed:true,
  deniedStateFailsClosed:true
});
