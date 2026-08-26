'use strict';

const assert = require('assert');
const { ToolExecutionGuard, fingerprint } = require('../src/tool-surface');

const materialHash = fingerprint('write_file', {path:'x.txt',text:'hello'});
const observationHash = fingerprint('read_file', {path:'x.txt'});

const native = new ToolExecutionGuard();
native.restore([
  {tool:'write_file', args:{path:'x.txt',text:'hello'}, fingerprint:materialHash, ok:true, material:true, observation:false, at:'t1'}
]);
assert.strictEqual(native.canFinalize(), false);
assert.strictEqual(native.verificationDebt.tool, 'write_file');

const mission = new ToolExecutionGuard();
mission.restore([
  {id:'m1', tool:'write_file', argumentsHash:materialHash, outcome:'success', material:true, verification:false, at:'t1'},
  {id:'m2', tool:'read_file', argumentsHash:observationHash, outcome:'observed', material:false, verification:true, at:'t2'}
]);
assert.strictEqual(mission.canFinalize(), true);
assert.strictEqual(mission.history[0].verifiedBy, observationHash);
assert.strictEqual(mission.history[1].verifies, materialHash);

const interrupted = new ToolExecutionGuard();
const state = interrupted.restore([
  {id:'m1', tool:'write_file', argumentsHash:materialHash, outcome:'success', material:true, verification:false, at:'t1'}
]);
assert.strictEqual(interrupted.canFinalize(), false);
assert.strictEqual(state.verificationDebt.fingerprint, materialHash);

const failed = new ToolExecutionGuard();
failed.restore([
  {tool:'write_file', argumentsHash:materialHash, outcome:'failed', material:true, verification:false, at:'t1'}
]);
assert.strictEqual(failed.canFinalize(), true);

console.log('ToolExecutionGuard recovery compatibility PASS', {
  nativeTrace: true,
  missionTrace: true,
  interruptedDebtPreserved: true,
  failedActionNoDebt: true
});
