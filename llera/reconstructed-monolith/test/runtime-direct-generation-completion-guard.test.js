'use strict';

const assert = require('assert');
const { RuntimeLifecycle } = require('../src/runtime-lifecycle');

async function run() {
  let pid = 2000;
  const runtime = new RuntimeLifecycle({
    start: async () => ({ pid: ++pid }),
    stop: async () => {},
    health: async () => true
  });

  await runtime.ensureRunning('model-a');
  const first = runtime.registerInference('shared-id', { abort: async () => {} });
  assert.equal(first.generation, 1);
  runtime.completeInference('shared-id', first.generation);

  await runtime.stop('restart');
  await runtime.ensureRunning('model-a');
  const second = runtime.registerInference('shared-id', { abort: async () => {} });
  assert.equal(second.generation, 2);

  // A delayed completion from generation 1 must never remove a new task that
  // reused the same logical inference ID after runtime restart/recovery.
  assert.equal(runtime.completeInference('shared-id', first.generation), false);
  assert.equal(runtime.snapshot().activeInference.length, 1);
  assert.equal(runtime.snapshot().activeInference[0].generation, second.generation);

  assert.equal(runtime.completeInference('shared-id', second.generation), true);
  assert.equal(runtime.snapshot().activeInference.length, 0);

  console.log('RUNTIME_DIRECT_GENERATION_COMPLETION_GUARD_PASS');
}

run().catch(err => {
  console.error(err.stack || err);
  process.exit(1);
});
