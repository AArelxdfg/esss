'use strict';

const assert = require('assert');
const { RuntimeLifecycle } = require('../src/runtime-lifecycle');
const { RuntimeInferenceCoordinator } = require('../src/runtime-inference-coordinator');

class Governor {
  constructor() { this.active = new Map(); }
  admit({ id, className }) {
    const record = { allow: true, id, className, pressure: 'normal', maxTokens: 4096, reasoning: 'normal', startedAt: Date.now() };
    this.active.set(id, record);
    return record;
  }
  complete(id) { return this.active.delete(id); }
  snapshot() { return { active: [...this.active.keys()] }; }
}

async function run() {
  let pid = 3000;
  const runtime = new RuntimeLifecycle({
    start: async () => ({ pid: ++pid }),
    stop: async () => {},
    health: async () => true
  });

  await runtime.ensureRunning('model-a');
  const first = runtime.registerInference('direct-shared', { abort: async () => {} });
  assert.strictEqual(first.generation, 1);
  assert.strictEqual(runtime.completeInference('direct-shared'), false, 'direct completion without generation must fail closed');
  assert.strictEqual(runtime.snapshot().activeInference.length, 1);
  assert.strictEqual(runtime.completeInference('direct-shared', first.generation), true);

  const governor = new Governor();
  const coordinator = new RuntimeInferenceCoordinator({ runtime, governor });
  const admitted = coordinator.begin({ id: 'coordinator-shared', className: 'interactive', abort: async () => {} });
  assert.strictEqual(admitted.allow, true);
  assert.strictEqual(coordinator.complete('coordinator-shared'), false, 'coordinator completion without generation must fail closed');
  assert.strictEqual(runtime.activeInference.has('coordinator-shared'), true);
  assert.strictEqual(governor.active.has('coordinator-shared'), true);
  assert.strictEqual(coordinator.active.has('coordinator-shared'), true);

  const audit = coordinator.snapshot().completed.find(x => x.reason === 'generation-required');
  assert.ok(audit, 'unbound completion rejection must be observable');
  assert.strictEqual(audit.activeGeneration, admitted.generation);

  assert.strictEqual(coordinator.complete('coordinator-shared', admitted.generation), true);
  assert.strictEqual(runtime.activeInference.has('coordinator-shared'), false);
  assert.strictEqual(governor.active.has('coordinator-shared'), false);
  assert.strictEqual(coordinator.active.has('coordinator-shared'), false);

  console.log('RUNTIME_GENERATION_REQUIRED_COMPLETION_PASS');
}

run().catch(err => {
  console.error(err.stack || err);
  process.exit(1);
});
