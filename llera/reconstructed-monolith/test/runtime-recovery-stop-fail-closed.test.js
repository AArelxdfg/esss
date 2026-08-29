'use strict';

const assert = require('assert');
const { RuntimeLifecycle } = require('../src/runtime-lifecycle');

(async () => {
  let nextPid = 4100;
  let startCount = 0;
  let stopCount = 0;
  let failStop = true;

  const runtime = new RuntimeLifecycle({
    start: async ({ model }) => {
      startCount += 1;
      return { pid: ++nextPid, model };
    },
    stop: async ({ pid }) => {
      stopCount += 1;
      if (failStop) throw new Error(`simulated stop failure for ${pid}`);
      return { stopped: true };
    },
    health: async () => true
  });

  const initial = await runtime.ensureRunning('model-a', 'initial');
  assert.strictEqual(initial.state, 'ready');
  assert.strictEqual(startCount, 1);
  const originalPid = initial.pid;

  await assert.rejects(
    () => runtime.recover('forced-health-failure'),
    /simulated stop failure/
  );

  const failed = runtime.snapshot();
  assert.strictEqual(failed.state, 'failed');
  assert.strictEqual(failed.pid, originalPid, 'unknown-live backend pid must remain tracked');
  assert.strictEqual(failed.model, 'model-a', 'unknown-live backend model must remain tracked');
  assert.match(failed.lastError, /recovery stop failed/);
  assert.strictEqual(startCount, 1, 'recovery must not launch a second runtime after stop failure');

  await assert.rejects(
    () => runtime.ensureRunning('model-b', 'unsafe-direct-restart'),
    error => error && error.code === 'RUNTIME_ORPHAN_UNRESOLVED'
  );
  assert.strictEqual(startCount, 1, 'direct ensureRunning must not bypass unresolved-pid guard');

  failStop = false;
  const recovered = await runtime.recover('retry-after-stop-restored');
  assert.strictEqual(recovered.state, 'ready');
  assert.strictEqual(recovered.model, 'model-b', 'latest desired model remains the recovery target');
  assert.notStrictEqual(recovered.pid, originalPid);
  assert.strictEqual(startCount, 2);
  assert.ok(stopCount >= 2);

  console.log('MONOLITH runtime recovery stop fail-closed PASS', {
    duplicateRuntimeLaunchBlocked: true,
    unresolvedPidPreserved: true,
    unsafeEnsureRunningBlocked: true,
    retryRecoverySucceeded: true
  });
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
