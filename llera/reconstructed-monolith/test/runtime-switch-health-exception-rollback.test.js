'use strict';

const assert = require('assert');
const { RuntimeLifecycle } = require('../src/runtime-lifecycle');

async function run() {
  let nextPid = 6100;
  const alive = new Set();
  const starts = [];
  const stops = [];

  const runtime = new RuntimeLifecycle({
    start: async ({ model, generation }) => {
      const pid = ++nextPid;
      starts.push({ pid, model, generation });
      alive.add(pid);
      return { pid };
    },
    stop: async ({ pid, model, reason }) => {
      stops.push({ pid, model, reason });
      alive.delete(pid);
    },
    health: async ({ model }) => {
      if (model === 'target-broken') {
        const error = new Error('health transport exploded');
        error.code = 'HEALTH_TRANSPORT_FAILURE';
        throw error;
      }
      return true;
    },
    isAlive: async ({ pid }) => alive.has(pid),
    now: (() => { let n = 9000; return () => ++n; })()
  });

  const first = await runtime.ensureRunning('stable-model');
  assert.equal(first.state, 'ready');
  assert.equal(first.model, 'stable-model');
  assert.equal(alive.size, 1);

  await assert.rejects(
    runtime.ensureRunning('target-broken'),
    error => error && error.code === 'HEALTH_TRANSPORT_FAILURE'
  );

  const restored = runtime.snapshot();
  assert.equal(restored.state, 'ready');
  assert.equal(restored.model, 'stable-model');
  assert.equal(restored.desiredModel, 'target-broken');
  assert.equal(restored.switchRollbackCount, 1);
  assert.equal(restored.lastSwitchFailure.from, 'stable-model');
  assert.equal(restored.lastSwitchFailure.to, 'target-broken');
  assert.equal(restored.lastSwitchFailure.restored, true);
  assert.equal(alive.size, 1, 'rollback must leave exactly one live llama runtime');

  assert.deepEqual(starts.map(item => item.model), ['stable-model', 'target-broken', 'stable-model']);
  assert(stops.some(item => item.model === 'stable-model'), 'old runtime must be drained/stopped before target launch');
  assert(stops.some(item => item.model === 'target-broken'), 'failed target runtime must be cleaned before rollback');

  const livePid = [...alive][0];
  const rollbackStart = starts.at(-1);
  assert.equal(livePid, rollbackStart.pid, 'only the rollback runtime may remain alive');

  console.log(JSON.stringify({
    pass: true,
    healthExceptionRollback: true,
    failedTargetCleanup: true,
    singleRuntimePreserved: true,
    preferredTargetPreserved: true
  }));
}

run().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
