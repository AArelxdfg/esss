'use strict';
const assert = require('assert');
const { ToolExecutionGuard } = require('../src/tool-surface');

(() => {
  const downgraded = new ToolExecutionGuard();
  downgraded.restore([{
    tool:'write_file', args:{path:'secure.txt'}, outcome:'success',
    material:false, observation:true, verification:true
  }]);
  assert.ok(downgraded.verificationDebt, 'persisted material=false must not downgrade write_file');
  assert.strictEqual(downgraded.history[0].material, true);
  assert.strictEqual(downgraded.history[0].observation, false);
  assert.strictEqual(downgraded.canFinalize(), false);

  const nonObservationPromotion = new ToolExecutionGuard();
  nonObservationPromotion.restore([
    {tool:'write_file',args:{path:'secure.txt'},outcome:'success'},
    {tool:'clipboard_write',args:{path:'secure.txt'},outcome:'success',observation:true,verification:true}
  ]);
  assert.ok(nonObservationPromotion.verificationDebt, 'persisted observation=true must not promote clipboard_write');

  const recordedEvidence = new ToolExecutionGuard();
  const material = recordedEvidence.record('write_file',{path:'secure.txt'},{ok:true});
  assert.ok(recordedEvidence.verificationDebt);
  const recordOnly = recordedEvidence.record('evidence_record',{path:'secure.txt'},{
    ok:true,
    verification:true,
    verifiesFingerprint:material.fingerprint
  });
  assert.strictEqual(recordOnly.observation, false, 'evidence_record is not an independent observation');
  assert.ok(recordedEvidence.verificationDebt, 'evidence_record alone must not clear debt');

  const unscoped = new ToolExecutionGuard();
  const command = unscoped.record('run_command',{command:'echo material'},{ok:true});
  assert.strictEqual(unscoped.verificationDebt.scope, null);
  unscoped.record('system_info',{}, {ok:true,verification:true});
  assert.ok(unscoped.verificationDebt, 'unscoped debt must not clear from a generic verification flag');
  const exact = unscoped.record('evidence_verify',{evidenceId:'ev1'}, {
    ok:true,
    verifiesFingerprint:command.fingerprint
  });
  assert.strictEqual(exact.verifies, command.fingerprint);
  assert.strictEqual(unscoped.verificationDebt, null, 'exact fingerprint observation must clear unscoped debt');

  const scopedRestart = new ToolExecutionGuard();
  scopedRestart.restore([
    {tool:'write_file',argumentsHash:'a'.repeat(64),scope:'path:secure.txt',outcome:'success',material:false},
    {tool:'read_file',argumentsHash:'b'.repeat(64),scope:'path:other.txt',outcome:'observed',observation:true,verification:true}
  ]);
  assert.ok(scopedRestart.verificationDebt, 'wrong-scope observation must not clear restored debt');
  scopedRestart.restore([
    ...scopedRestart.history,
    {tool:'read_file',argumentsHash:'c'.repeat(64),scope:'path:secure.txt',outcome:'observed',observation:false,verification:true}
  ]);
  assert.strictEqual(scopedRestart.verificationDebt, null, 'canonical read_file observation must close same-scope debt');

  const loop = new ToolExecutionGuard({maxSameFailure:2});
  loop.record('read_file',{path:'same.txt'},{ok:false});
  loop.record('read_file',{path:'same.txt'},{ok:false});
  assert.strictEqual(loop.decide('read_file',{path:'same.txt'}).reason,'anti_loop_same_failure');

  console.log('verification debt adversarial PASS', {
    canonicalMaterialCannotDowngrade:true,
    nonObservationCannotSelfPromote:true,
    evidenceRecordCannotClearDebt:true,
    unscopedRequiresExactFingerprint:true,
    scopedRestartRequiresSameTarget:true,
    semanticNoOpLoopDetected:true,
    unverifiableMaterialCannotFinalize:true
  });
})();
