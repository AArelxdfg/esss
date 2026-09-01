'use strict';
const assert = require('assert');
const { RuntimeLifecycle } = require('../src/runtime-lifecycle');

(async () => {
  // 1) A backend stop that never settles must not hang the lifecycle forever.
  {
    const runtime = new RuntimeLifecycle({
      start: async () => ({pid:101}),
      stop: async () => new Promise(() => {}),
      health: async () => true,
      isAlive: async () => true,
      stopTimeoutMs:25
    });
    await runtime.ensureRunning('model-a');
    const started = Date.now();
    await assert.rejects(
      () => runtime.stop('timeout-test'),
      error => error && error.code === 'RUNTIME_STOP_TIMEOUT' && error.pid === 101
    );
    assert(Date.now() - started < 1000, 'bounded stop must return instead of hanging');
    const state = runtime.snapshot();
    assert.strictEqual(state.state,'failed');
    assert.strictEqual(state.pid,101,'timed-out live pid must remain tracked');
    assert.strictEqual(state.model,'model-a');
  }

  // 2) A PID killed outside LLera is not an unresolved live orphan.
  {
    let stopCalls = 0;
    let alive = true;
    const runtime = new RuntimeLifecycle({
      start: async () => ({pid:202}),
      stop: async () => { stopCalls += 1; },
      health: async () => true,
      isAlive: async () => alive,
      stopTimeoutMs:100
    });
    await runtime.ensureRunning('model-b');
    alive = false; // external kill after successful startup
    const stopped = await runtime.stop('external-kill-reconcile');
    assert.strictEqual(stopped.state,'stopped');
    assert.strictEqual(stopped.pid,null);
    assert.strictEqual(stopCalls,0,'dead external pid must not be sent to stop backend');
    assert.strictEqual(stopped.lastBackendExit.kind,'external-dead');
    assert.strictEqual(stopped.lastBackendExit.pid,202);
  }

  // 3) A dirty failed-state PID becomes restartable only after an explicit death probe.
  {
    let starts = 0;
    let alive = true;
    const runtime = new RuntimeLifecycle({
      start: async () => ({pid: starts++ === 0 ? 303 : 304}),
      stop: async () => { throw new Error('access denied'); },
      health: async ({pid}) => pid === 304,
      isAlive: async ({pid}) => pid === 303 ? alive : true,
      stopTimeoutMs:100
    });
    await assert.rejects(() => runtime.ensureRunning('model-c'), /health check failed/);
    let dirty = runtime.snapshot();
    assert.strictEqual(dirty.state,'failed');
    assert.strictEqual(dirty.pid,303,'failed cleanup must preserve live orphan identity');

    alive = false; // the orphan exits outside LLera after the failed cleanup
    const restarted = await runtime.ensureRunning('model-c','retry-after-external-exit');
    assert.strictEqual(restarted.state,'ready');
    assert.strictEqual(restarted.pid,304);
    assert.strictEqual(restarted.lastBackendExit.kind,'external-dead');
    assert.strictEqual(restarted.lastBackendExit.pid,303);
  }

  // 4) stopBackend resolving is not enough when the process probe says it is still alive.
  {
    const runtime = new RuntimeLifecycle({
      start: async () => ({pid:404}),
      stop: async () => undefined,
      health: async () => true,
      isAlive: async () => true,
      stopTimeoutMs:100
    });
    await runtime.ensureRunning('model-d');
    await assert.rejects(
      () => runtime.stop('lying-stop-backend'),
      error => error && error.code === 'RUNTIME_STOP_DID_NOT_TERMINATE' && error.pid === 404
    );
    const failed = runtime.snapshot();
    assert.strictEqual(failed.state,'failed');
    assert.strictEqual(failed.pid,404,'still-live pid must remain tracked fail-closed');
  }

  // 5) A ready record with an externally dead PID must reconcile before claiming readiness.
  {
    let starts = 0;
    let firstAlive = true;
    const runtime = new RuntimeLifecycle({
      start: async () => ({pid: starts++ === 0 ? 505 : 506}),
      stop: async () => undefined,
      health: async () => true,
      isAlive: async ({pid}) => pid === 505 ? firstAlive : true,
      stopTimeoutMs:100
    });
    await runtime.ensureRunning('model-e');
    firstAlive = false;
    const recovered = await runtime.ensureRunning('model-e','ready-record-reconcile');
    assert.strictEqual(recovered.state,'ready');
    assert.strictEqual(recovered.pid,506,'stale ready pid must not be returned as healthy runtime');
    assert.strictEqual(recovered.lastBackendExit.kind,'external-dead');
  }

  console.log('MONOLITH runtime PID guard edge cases PASS', {
    stopTimeoutFailsClosed:true,
    externalKillDistinguished:true,
    dirtyDeadPidReconciled:true,
    lyingStopBackendRejected:true,
    staleReadyPidReconciled:true
  });
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
