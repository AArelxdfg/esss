'use strict';

const assert = require('assert');
const { ToolExecutionGuard } = require('../src/tool-surface');
const { GuardedMonolithToolBroker, executionSucceeded } = require('../src/guarded-tool-broker');

(async () => {
  let readAttempts = 0;
  const broker = new GuardedMonolithToolBroker({
    historicalExecutor: async (tool, args) => {
      if (tool === 'write_file') return { ok:true, written:args.path };
      if (tool === 'read_file') {
        readAttempts += 1;
        if (readAttempts === 1) return { ok:false, error:'simulated read failure' };
        return { ok:true, text:'verified bytes' };
      }
      throw new Error(`unexpected:${tool}`);
    },
    guard: new ToolExecutionGuard()
  });

  assert.strictEqual(executionSucceeded('read_file', { ok:false }), false);
  assert.strictEqual(executionSucceeded('read_file', { success:false }), false);
  assert.strictEqual(executionSucceeded('read_file', { status:'failed' }), false);
  assert.strictEqual(executionSucceeded('read_file', { exists:false }), true);
  assert.strictEqual(executionSucceeded('evidence_verify', { verified:false }), false);

  const write = await broker.invoke('write_file', { path:'x.txt', text:'hello' });
  assert.strictEqual(write.ok, true);
  assert.strictEqual(write.canFinalize, false);

  const failedObservation = await broker.invoke('read_file', { path:'x.txt' });
  assert.strictEqual(failedObservation.ok, false);
  assert.strictEqual(failedObservation.semanticFailure, true);
  assert.strictEqual(failedObservation.canFinalize, false);
  assert.ok(failedObservation.verificationDebt, 'failed observation must not discharge debt');

  const successfulObservation = await broker.invoke('read_file', { path:'x.txt' });
  assert.strictEqual(successfulObservation.ok, true);
  assert.strictEqual(successfulObservation.canFinalize, true);
  assert.strictEqual(successfulObservation.verificationDebt, null);

  console.log('MONOLITH semantic verification gate PASS', {
    failedObservationKeepsDebt:true,
    explicitFailurePropagates:true,
    successfulObservationClosesDebt:true,
    evidenceVerifyFalseRejected:true
  });
})().catch(error => {
  console.error(error);
  process.exit(1);
});
