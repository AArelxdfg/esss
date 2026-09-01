'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RuntimeLifecycle } = require('../src/runtime-lifecycle');

test('failed model-switch drain preserves the active model as desired recovery target', async () => {
  const starts = [];
  const stops = [];
  let nextPid = 12000;

  const runtime = new RuntimeLifecycle({
    start: async ({ model, generation }) => {
      const pid = ++nextPid;
      starts.push({ model, generation, pid });
      return { pid };
    },
    health: async () => true,
    stop: async ({ pid, model, reason }) => {
      stops.push({ pid, model, reason });
    }
  });

  const initial = await runtime.ensureRunning('model-a');
  assert.equal(initial.state, 'ready');
  assert.equal(initial.model, 'model-a');
  assert.equal(initial.desiredModel, 'model-a');

  const task = runtime.registerInference('chat-1', {
    abort: async () => {
      const error = new Error('consumer refused drain');
      error.code = 'TEST_ABORT_FAILURE';
      throw error;
    }
  });

  await assert.rejects(
    () => runtime.ensureRunning('model-b', 'user-model-switch'),
    /inference drain failed: chat-1/
  );

  const failedSwitch = runtime.snapshot();
  assert.equal(failedSwitch.state, 'ready');
  assert.equal(failedSwitch.model, 'model-a');
  assert.equal(failedSwitch.desiredModel, 'model-a');
  assert.equal(failedSwitch.pid, initial.pid);
  assert.equal(failedSwitch.generation, initial.generation);
  assert.deepEqual(failedSwitch.activeInference.map(entry => entry.id), ['chat-1']);
  assert.equal(starts.length, 1);
  assert.equal(stops.length, 0);
  assert.equal(failedSwitch.lastSwitchFailure.from, 'model-a');
  assert.equal(failedSwitch.lastSwitchFailure.to, 'model-b');
  assert.equal(failedSwitch.lastSwitchFailure.restored, true);
  assert.equal(failedSwitch.lastSwitchFailure.restoredGeneration, initial.generation);
  assert.equal(failedSwitch.lastSwitchFailure.phase, 'drain');
  assert.match(failedSwitch.lastSwitchFailure.error, /inference drain failed: chat-1/);

  assert.equal(runtime.completeInference(task.id, task.generation), true);
  const recovered = await runtime.recover('post-switch-drain-failure');
  assert.equal(recovered.state, 'ready');
  assert.equal(recovered.model, 'model-a');
  assert.equal(recovered.desiredModel, 'model-a');
  assert.equal(recovered.generation, initial.generation + 1);
  assert.equal(starts.length, 2);
  assert.equal(starts[1].model, 'model-a');
});
