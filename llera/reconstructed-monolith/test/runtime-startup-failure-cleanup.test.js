'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RuntimeLifecycle } = require('../src/runtime-lifecycle');

test('failed startup health probe cleans the spawned backend and leaves no tracked runtime', async () => {
  const starts = [];
  const stops = [];
  const health = [];

  const runtime = new RuntimeLifecycle({
    start: async ({ model, generation }) => {
      starts.push({ model, generation });
      return { pid: 7001 };
    },
    health: async ({ pid, model }) => {
      health.push({ pid, model });
      return false;
    },
    stop: async ({ pid, model, reason }) => {
      stops.push({ pid, model, reason });
    },
  });

  await assert.rejects(
    () => runtime.ensureRunning('tinyllama-validation'),
    /runtime health check failed/
  );

  const snapshot = runtime.snapshot();
  assert.equal(starts.length, 1);
  assert.deepEqual(starts[0], { model: 'tinyllama-validation', generation: 1 });
  assert.deepEqual(health, [{ pid: 7001, model: 'tinyllama-validation' }]);
  assert.equal(stops.length, 1);
  assert.equal(stops[0].pid, 7001);
  assert.equal(stops[0].model, 'tinyllama-validation');
  assert.equal(stops[0].reason, 'failed-start-cleanup');
  assert.equal(snapshot.state, 'failed');
  assert.equal(snapshot.pid, null);
  assert.equal(snapshot.model, null);
  assert.equal(snapshot.activeInference.length, 0);
  assert.match(snapshot.lastError, /runtime health check failed/);
});

test('failed model switch rolls back to the previous healthy model after cleanup', async () => {
  let nextPid = 8000;
  const starts = [];
  const stops = [];
  let targetHealthFailures = 0;

  const runtime = new RuntimeLifecycle({
    start: async ({ model, generation }) => {
      const pid = ++nextPid;
      starts.push({ model, generation, pid });
      return { pid };
    },
    health: async ({ model }) => {
      if (model === 'broken-target' && targetHealthFailures++ === 0) return false;
      return true;
    },
    stop: async ({ pid, model, reason }) => {
      stops.push({ pid, model, reason });
    },
  });

  const initial = await runtime.ensureRunning('healthy-baseline');
  assert.equal(initial.state, 'ready');
  assert.equal(initial.model, 'healthy-baseline');

  await assert.rejects(
    () => runtime.ensureRunning('broken-target'),
    /runtime health check failed/
  );

  const snapshot = runtime.snapshot();
  assert.equal(snapshot.state, 'ready');
  assert.equal(snapshot.model, 'healthy-baseline');
  assert.equal(snapshot.desiredModel, 'broken-target');
  assert.equal(snapshot.switchRollbackCount, 1);
  assert.equal(snapshot.lastSwitchFailure.from, 'healthy-baseline');
  assert.equal(snapshot.lastSwitchFailure.to, 'broken-target');
  assert.equal(snapshot.lastSwitchFailure.restored, true);
  assert.ok(starts.some(entry => entry.model === 'broken-target'));
  assert.equal(starts.filter(entry => entry.model === 'healthy-baseline').length, 2);
  assert.ok(stops.some(entry => entry.model === 'broken-target' && entry.reason === 'failed-start-cleanup'));
});
