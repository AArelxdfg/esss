'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RuntimeLifecycle } = require('../src/runtime-lifecycle');

function createHarness() {
  let nextPid = 7000;
  const alive = new Map();
  const runtime = new RuntimeLifecycle({
    start: async () => {
      const pid = ++nextPid;
      alive.set(pid, true);
      return { pid };
    },
    stop: async ({ pid }) => {
      alive.set(pid, false);
    },
    health: async () => true,
    isAlive: async ({ pid }) => alive.get(pid) === true,
    now: (() => {
      let t = 1000;
      return () => ++t;
    })()
  });
  return { runtime, alive };
}

test('orphan cleanup is bound to the generation that actually died', async () => {
  const { runtime, alive } = createHarness();

  const first = await runtime.ensureRunning('model-a.gguf', 'initial');
  assert.equal(first.generation, 1);
  const deadPid = first.pid;

  const task = runtime.registerInference('chat-1', {
    priority: 'high',
    abort: async () => {}
  });
  assert.equal(task.generation, 1);

  alive.set(deadPid, false);

  const recovered = await runtime.ensureRunning('model-a.gguf', 'probe-after-external-death');
  assert.equal(recovered.state, 'ready');
  assert.equal(recovered.generation, 2);
  assert.notEqual(recovered.pid, deadPid);

  const cleanup = recovered.lastOrphanedInferenceCleanup;
  assert.ok(cleanup);
  assert.equal(cleanup.generation, 1);
  assert.deepEqual(cleanup.aborted, ['chat-1']);
  assert.deepEqual(cleanup.failures, []);
  assert.match(cleanup.reason, /^runtime-external-death:/);

  // The cleanup event must remain bound to generation 1 even though the
  // lifecycle is already serving generation 2 when observers read snapshot().
  assert.equal(runtime.snapshot().lastOrphanedInferenceCleanup.generation, 1);
});
