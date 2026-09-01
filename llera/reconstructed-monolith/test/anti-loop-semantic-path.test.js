'use strict';
const assert = require('assert');
const { ToolExecutionGuard, fingerprint, semanticFingerprint } = require('../src/tool-surface');

assert.notStrictEqual(
  fingerprint('write_file',{path:'C:\\LLera\\State\\x.txt',content:'same'}),
  fingerprint('write_file',{path:'c:/llera/state/x.txt/',content:'same'})
);
assert.strictEqual(
  semanticFingerprint('write_file',{path:'C:\\LLera\\State\\x.txt',content:'same'}),
  semanticFingerprint('write_file',{path:'c:/llera/state/x.txt/',content:'same'})
);

const guard = new ToolExecutionGuard({maxSameFailure:2});
const first = guard.record('write_file',{path:'C:\\LLera\\State\\x.txt',content:'same'},{ok:false});
assert.strictEqual(first.recorded,true);
const second = guard.record('write_file',{path:'c:/llera/state/x.txt/',content:'same'},{ok:false});
assert.strictEqual(second.recorded,true);
const third = guard.decide('write_file',{path:'C:/LLERA/STATE//x.txt',content:'same'});
assert.strictEqual(third.allow,false);
assert.strictEqual(third.reason,'anti_loop_same_failure');

const restored = new ToolExecutionGuard({maxSameFailure:2});
restored.restore([
  {tool:'write_file',args:{path:'C:\\LLera\\State\\x.txt',content:'same'},ok:false},
  {tool:'write_file',args:{path:'c:/llera/state/x.txt/',content:'same'},ok:false}
]);
const afterRestart = restored.decide('write_file',{path:'C:/LLERA/STATE/x.txt',content:'same'});
assert.strictEqual(afterRestart.allow,false);
assert.strictEqual(afterRestart.reason,'anti_loop_same_failure');

console.log('MONOLITH semantic anti-loop path normalization PASS', {
  pathAliasFailuresCoalesce:true,
  legacyPrimaryFingerprintPreserved:true,
  restartReconstructsSemanticFingerprint:true
});
