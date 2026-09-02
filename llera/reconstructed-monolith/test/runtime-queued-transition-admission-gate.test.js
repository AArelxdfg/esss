'use strict';

const assert = require('assert');
const { RuntimeLifecycle } = require('../src/runtime-lifecycle');

async function run() {
  let nextPid = 7200;
  const alive = new Set();
  const aborts = [];

  const runtime = new RuntimeLifecycle({
    start: async () => {
      const pid = ++nextPid;
      alive.add(pid);
      return { pid };
    },
    stop: async ({ pid }) => {
      alive.delete(pid);
    },
    health: async () => true,
    isAlive: async ({ pid }) => alive.has(pid),
    now: (() => { let n = 12000; return () => ++n; })()
  });

  await runtime.ensureRunning('model-a');
  runtime.registerInference('low-before-switch', {
    priority: 'low',
    abort: async reason => { aborts.push({ id: 'low-before-switch', reason }); }
  });

  const switching = runtime.ensureRunning('model-b', 'queued-switch');

  const queued = runtime.snapshot();
  assert.equal(queued.lifecyclePending, 1, 'queued lifecycle work must be visible synchronously');
  assert.equal(queued.lifecycleOperation, null, 'queued work may exist before the lifecycle owner starts');

  assert.throws(
    () => runtime.registerInference('late-admission', { abort: async () => {} }),
    /lifecycle transition in progress/,
    'new inference must be rejected as soon as a lifecycle transition is queued'
  );

  const pressure = await runtime.applyHostPressure('CRITICAL');
  assert.equal(pressure.deferred, true, 'host-pressure preemption must defer while lifecycle work is queued');
  assert.deepEqual(aborts, [], 'queued transition gate must prevent pressure from racing the pending switch');

  const switched = await switching;
  assert.equal(switched.state, 'ready');
  assert.equal(switched.model, 'model-b');
  assert.equal(switched.lifecyclePending, 1, 'operation snapshot is taken before its pending counter is finalized');

  const settled = runtime.snapshot();
  assert.equal(settled.lifecyclePending, 0);
  assert.equal(settled.activeInference.length, 0);
  assert.equal(alive.size, 1, 'model switch must preserve the single-runtime invariant');
  assert.equal(aborts.length, 1, 'the pre-existing inference must be drained by the switch owner');
  assert.match(aborts[0].reason, /model-switch:model-a->model-b/);

  console.log(JSON.stringify({
    pass: true,
    queuedLifecycleAdmissionClosed: true,
    queuedPressureDeferred: true,
    singleRuntimePreserved: true
  }));
}

run().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
