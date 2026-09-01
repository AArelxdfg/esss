'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RuntimeLifecycle } = require('../src/runtime-lifecycle');

test('external llama runtime death aborts tracked inference before transparent restart', async () => {
  let nextPid = 9000;
  let alive = true;
  const aborted = [];
  const starts = [];

  const runtime = new RuntimeLifecycle({
    start: async ({ model, generation }) => {
      const pid = ++nextPid;
      starts.push({ model, generation, pid });
      alive = true;
      return { pid };
    },
    stop: async () => { alive = false; },
    health: async () => true,
    isAlive: async () => alive,
  });

  const first = await runtime.ensureRunning('tinyllama-validation');
  runtime.registerInference('chat-1', { abort: async reason => aborted.push({ id: 'chat-1', reason }) });
  runtime.registerInference('work-1', { priority: 'low', abort: async reason => aborted.push({ id: 'work-1', reason }) });

  alive = false;
  const recovered = await runtime.ensureRunning('tinyllama-validation');

  assert.equal(first.generation, 1);
  assert.equal(recovered.state, 'ready');
  assert.equal(recovered.generation, 2);
  assert.equal(starts.length, 2);
  assert.equal(recovered.activeInference.length, 0);
  assert.deepEqual(aborted.map(item => item.id), ['chat-1', 'work-1']);
  assert.ok(aborted.every(item => item.reason === 'runtime-external-death:ensure-ready-probe'));
  assert.equal(recovered.lastBackendExit.kind, 'external-dead');
  assert.deepEqual(recovered.lastOrphanedInferenceCleanup.aborted, ['chat-1', 'work-1']);
  assert.deepEqual(recovered.lastOrphanedInferenceCleanup.failures, []);
});

test('orphaned inference cleanup records abort failures but does not block dead-runtime recovery', async () => {
  let nextPid = 9100;
  let alive = true;
  const runtime = new RuntimeLifecycle({
    start: async () => {
      alive = true;
      return { pid: ++nextPid };
    },
    stop: async () => { alive = false; },
    health: async () => true,
    isAlive: async () => alive,
  });

  await runtime.ensureRunning('tinyllama-validation');
  runtime.registerInference('healthy-abort', { abort: async () => {} });
  runtime.registerInference('broken-abort', { abort: async () => { throw new Error('consumer already gone'); } });

  alive = false;
  const recovered = await runtime.ensureRunning('tinyllama-validation');

  assert.equal(recovered.state, 'ready');
  assert.equal(recovered.generation, 2);
  assert.equal(recovered.activeInference.length, 0);
  assert.deepEqual(recovered.lastOrphanedInferenceCleanup.aborted, ['healthy-abort']);
  assert.equal(recovered.lastOrphanedInferenceCleanup.failures.length, 1);
  assert.equal(recovered.lastOrphanedInferenceCleanup.failures[0].id, 'broken-abort');
  assert.match(recovered.lastOrphanedInferenceCleanup.failures[0].error, /consumer already gone/);
});
