'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RuntimeLifecycle } = require('../src/runtime-lifecycle');

test('health exception cleans spawned backend and permits a clean retry', async () => {
  let nextPid = 9100;
  let healthAttempts = 0;
  const starts = [];
  const stops = [];

  const runtime = new RuntimeLifecycle({
    start: async ({ model, generation }) => {
      const pid = ++nextPid;
      starts.push({ model, generation, pid });
      return { pid };
    },
    health: async ({ pid, model }) => {
      healthAttempts += 1;
      if (healthAttempts === 1) {
        const error = new Error(`health transport failed for ${model} pid ${pid}`);
        error.code = 'ECONNRESET';
        throw error;
      }
      return true;
    },
    stop: async ({ pid, model, reason }) => {
      stops.push({ pid, model, reason });
    },
  });

  await assert.rejects(
    () => runtime.ensureRunning('tinyllama-validation'),
    /health transport failed/
  );

  const failed = runtime.snapshot();
  assert.equal(failed.state, 'failed');
  assert.equal(failed.pid, null);
  assert.equal(failed.model, null);
  assert.equal(failed.generation, 0);
  assert.equal(failed.activeInference.length, 0);
  assert.match(failed.lastError, /health transport failed/);
  assert.equal(stops.length, 1);
  assert.equal(stops[0].reason, 'failed-start-cleanup');
  assert.equal(stops[0].pid, starts[0].pid);

  const recovered = await runtime.ensureRunning('tinyllama-validation', 'retry-after-health-exception');
  assert.equal(recovered.state, 'ready');
  assert.equal(recovered.model, 'tinyllama-validation');
  assert.equal(recovered.generation, 1);
  assert.equal(recovered.lastError, null);
  assert.equal(healthAttempts, 2);
  assert.equal(starts.length, 2);
  assert.equal(starts[0].generation, 1);
  assert.equal(starts[1].generation, 1);
  assert.notEqual(starts[0].pid, starts[1].pid);

  const transitions = runtime.transitionLog.map(entry => `${entry.from}->${entry.to}`);
  assert.deepEqual(transitions, [
    'stopped->starting',
    'starting->failed',
    'failed->recovering',
    'recovering->starting',
    'starting->ready',
  ]);
});
