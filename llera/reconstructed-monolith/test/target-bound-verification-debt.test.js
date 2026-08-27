'use strict';
const assert = require('assert');
const { ToolExecutionGuard, fingerprint, verificationScope } = require('../src/tool-surface');

const guard = new ToolExecutionGuard();
const write = guard.record('write_file', {path:'C:\\Work\\report.txt', text:'hello'}, {ok:true});
assert.strictEqual(write.recorded, true);
assert.strictEqual(guard.canFinalize(), false);
assert.strictEqual(guard.verificationDebt.scope, 'path:c:/work/report.txt');

guard.record('system_info', {}, {ok:true});
assert.strictEqual(guard.canFinalize(), false, 'system_info must not verify write_file');

guard.record('read_file', {path:'C:\\Work\\other.txt'}, {ok:true});
assert.strictEqual(guard.canFinalize(), false, 'wrong target must not verify write_file');

const read = guard.record('read_file', {path:'C:/Work/report.txt'}, {ok:true});
assert.strictEqual(guard.canFinalize(), true);
assert.strictEqual(read.verifies, write.fingerprint);

const command = guard.record('run_command', {command:'echo hello'}, {ok:true});
assert.strictEqual(command.scope, null);
assert.strictEqual(guard.canFinalize(), false);
guard.record('system_info', {}, {ok:true, verifiesFingerprint: command.fingerprint});
assert.strictEqual(guard.canFinalize(), true);

const persistedWriteFp = fingerprint('write_file', {path:'D:\\LLera\\state.json', text:'x'});
const restored = new ToolExecutionGuard();
restored.restore([
  {id:'t1', tool:'write_file', arguments:{path:'D:\\LLera\\state.json',text:'x'}, argumentsHash:persistedWriteFp, outcome:'success', material:true, verification:false},
  {id:'t2', tool:'system_info', arguments:{}, outcome:'observed', material:false, verification:true}
]);
assert.strictEqual(restored.canFinalize(), false, 'unrelated persisted verification must not clear scoped debt');
assert.strictEqual(restored.verificationDebt.scope, 'path:d:/llera/state.json');

const restoredBound = new ToolExecutionGuard();
restoredBound.restore([
  {id:'t1', tool:'write_file', arguments:{path:'D:\\LLera\\state.json',text:'x'}, argumentsHash:persistedWriteFp, outcome:'success', material:true, verification:false},
  {id:'t2', tool:'hash_file', arguments:{path:'D:/LLera/state.json'}, outcome:'verified', material:false, verification:true}
]);
assert.strictEqual(restoredBound.canFinalize(), true);

assert.strictEqual(verificationScope('clipboard_write', {text:'x'}), 'clipboard:system');
assert.strictEqual(verificationScope('clipboard_read', {}), 'clipboard:system');

console.log('target-bound verification debt PASS', { unrelatedObservationBlocked:true, wrongTargetBlocked:true, sameTargetClosesDebt:true, explicitFingerprintBinding:true, restartScopePreserved:true });
