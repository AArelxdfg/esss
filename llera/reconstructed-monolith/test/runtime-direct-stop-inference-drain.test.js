'use strict';

const assert = require('assert');
const { RuntimeLifecycle } = require('../src/runtime-lifecycle');

(async () => {
  let nextPid = 4100;
  let stopCalls = 0;
  let abortMaySucceed = false;
  const aborts = [];

  const runtime = new RuntimeLifecycle({
    start: async () => ({ pid: ++nextPid }),
    stop: async () => { stopCalls += 1; },
    health: async () => true,
    now: (() => { let t = 1000; return () => ++t; })()
  });

  await runtime.ensureRunning('qwen3-next-80b-q4km');
  const original = runtime.snapshot();

  runtime.registerInference('foreground-chat', {
    priority: 'normal',
    abort: async (reason) => {
      aborts.push({ id: 'foreground-chat', reason });
    }
  });
  runtime.registerInference('stubborn-worker', {
    priority: 'low',
    abort: async (reason) => {
      aborts.push({ id: 'stubborn-worker', reason });
      if (!abortMaySucceed) throw new Error('worker refuses cancellation');
    }
  });

  await assert.rejects(
    () => runtime.stop('user-stop'),
    /inference drain failed: stubborn-worker/
  );

  const blocked = runtime.snapshot();
  assert.strictEqual(blocked.state, 'ready', 'failed drain must not transition runtime toward stopped');
  assert.strictEqual(blocked.pid, original.pid, 'failed drain must preserve the live backend pid');
  assert.strictEqual(blocked.model, original.model, 'failed drain must preserve the active model');
  assert.strictEqual(stopCalls, 0, 'backend stop must not run while tracked inference remains unresolved');
  assert.deepStrictEqual(blocked.activeInference.map(x => x.id), ['stubborn-worker']);
  assert.match(blocked.lastError, /stop inference drain failed/);

  abortMaySucceed = true;
  const stopped = await runtime.stop('user-stop-retry');
  assert.strictEqual(stopped.state, 'stopped');
  assert.strictEqual(stopped.pid, null);
  assert.strictEqual(stopped.model, null);
  assert.deepStrictEqual(stopped.activeInference, []);
  assert.strictEqual(stopCalls, 1, 'exactly one backend stop is allowed after the drain succeeds');

  const foregroundAttempts = aborts.filter(x => x.id === 'foreground-chat');
  const stubbornAttempts = aborts.filter(x => x.id === 'stubborn-worker');
  assert.strictEqual(foregroundAttempts.length, 1, 'successfully drained inference must not be replay-aborted on retry');
  assert.strictEqual(stubbornAttempts.length, 2, 'only unresolved inference should be retried');

  console.log('runtime direct-stop inference drain PASS', {
    failClosedOnAbortFailure: true,
    backendIdentityPreserved: true,
    backendStopDeferred: true,
    retryOnlyUnresolvedInference: true,
    singleBackendStop: true
  });
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
