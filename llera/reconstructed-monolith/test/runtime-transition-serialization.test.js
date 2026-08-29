'use strict';

const assert = require('assert');
const { RuntimeLifecycle } = require('../src/runtime-lifecycle');

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

(async () => {
  const starts = [];
  const stops = [];
  const firstStart = deferred();
  let first = true;
  let failHealthFor = null;
  let nextPid = 100;

  const runtime = new RuntimeLifecycle({
    start: async ({ model, generation }) => {
      starts.push({ model, generation });
      if (first) {
        first = false;
        return firstStart.promise;
      }
      nextPid += 1;
      return { pid: nextPid };
    },
    stop: async request => { stops.push({ ...request }); },
    health: async ({ model }) => model !== failHealthFor,
    now: (() => { let t = 0; return () => ++t; })()
  });

  // Rejected concurrent start must not mutate the preferred/desired model.
  const startingA = runtime.ensureRunning('model-a', 'boot-a');
  assert.strictEqual(runtime.state, 'starting');
  assert.strictEqual(runtime.desiredModel, 'model-a');
  await assert.rejects(
    runtime.ensureRunning('model-b', 'concurrent-boot-b'),
    error => error && error.code === 'RUNTIME_START_IN_PROGRESS'
  );
  assert.strictEqual(runtime.desiredModel, 'model-a', 'rejected concurrent start changed desiredModel');
  assert.strictEqual(starts.length, 1, 'rejected concurrent start launched a second backend');

  firstStart.resolve({ pid: 100 });
  await startingA;
  assert.strictEqual(runtime.state, 'ready');
  assert.strictEqual(runtime.model, 'model-a');
  assert.strictEqual(runtime.desiredModel, 'model-a');

  // A model switch owns the transition from admission-close through replacement
  // launch. A second switch request during drain must be observational only.
  const drain = deferred();
  runtime.registerInference('slow-inference', {
    abort: async () => drain.promise
  });
  const switchingB = runtime.ensureRunning('model-b', 'switch-b');
  await Promise.resolve();
  assert.strictEqual(runtime.inferenceAdmissionClosed, true);
  assert.strictEqual(runtime.desiredModel, 'model-b');
  await assert.rejects(
    runtime.ensureRunning('model-c', 'concurrent-switch-c'),
    error => error && error.code === 'RUNTIME_TRANSITION_IN_PROGRESS'
  );
  assert.strictEqual(runtime.desiredModel, 'model-b', 'rejected concurrent switch changed desiredModel');
  assert.strictEqual(starts.length, 1, 'concurrent switch launched before drain completed');

  drain.resolve();
  await switchingB;
  assert.strictEqual(runtime.state, 'ready');
  assert.strictEqual(runtime.model, 'model-b');
  assert.strictEqual(runtime.desiredModel, 'model-b');
  assert.strictEqual(starts.length, 2);
  assert.strictEqual(stops.filter(x => x.pid === 100).length, 1);

  // Recovery is an internal owner of the already-closed admission gate and must
  // still be able to relaunch the desired model without opening a bypass to
  // external ensureRunning calls.
  const beforeRecoveryStarts = starts.length;
  await runtime.recover('probe-failure');
  assert.strictEqual(runtime.state, 'ready');
  assert.strictEqual(runtime.model, 'model-b');
  assert.strictEqual(runtime.desiredModel, 'model-b');
  assert.strictEqual(starts.length, beforeRecoveryStarts + 1);

  // Failed target health must still permit the internal rollback path while the
  // external transition gate remains closed.
  failHealthFor = 'model-c';
  await assert.rejects(runtime.ensureRunning('model-c', 'switch-c-fails'), /runtime health check failed/);
  assert.strictEqual(runtime.state, 'ready');
  assert.strictEqual(runtime.model, 'model-b', 'failed switch did not restore previous runtime');
  assert.strictEqual(runtime.desiredModel, 'model-c', 'preferred failed target should remain desired for later recovery policy');
  assert.strictEqual(runtime.lastSwitchFailure && runtime.lastSwitchFailure.restored, true);
  assert.strictEqual(runtime.inferenceAdmissionClosed, false);

  console.log('MONOLITH runtime transition serialization PASS', {
    rejectedStartDoesNotMutateDesiredModel: true,
    rejectedSwitchDoesNotMutateDesiredModel: true,
    concurrentLaunchPrevented: true,
    recoveryInternalOwnershipPreserved: true,
    rollbackInternalOwnershipPreserved: true,
    singleRuntimeSwitchOrderPreserved: true
  });
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
