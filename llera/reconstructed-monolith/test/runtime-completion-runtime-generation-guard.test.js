'use strict';
const assert = require('assert');
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

class Runtime {
  constructor() { this.generation = 7; this.activeInference = new Map(); }
  registerInference(id, { priority, abort }) {
    const task = { id, priority, abort, generation: this.generation };
    this.activeInference.set(id, task);
    return task;
  }
  completeInference(id, expectedGeneration = null) {
    const task = this.activeInference.get(id);
    if (expectedGeneration !== null && (!task || task.generation !== expectedGeneration)) return false;
    return this.activeInference.delete(id);
  }
  snapshot() {
    return {
      generation: this.generation,
      activeInference: [...this.activeInference.values()].map(x => ({ id: x.id, generation: x.generation }))
    };
  }
}

(() => {
  const runtime = new Runtime();
  const governor = new Governor();
  const coordinator = new RuntimeInferenceCoordinator({ runtime, governor });

  const admitted = coordinator.begin({ id: 'reuse', className: 'interactive', abort: () => {} });
  assert.strictEqual(admitted.generation, 7);

  // Simulate a runtime replacement/re-registration that the coordinator has not
  // yet reconciled. The local record still says generation 7, while the actual
  // runtime task with the same id belongs to generation 8.
  runtime.generation = 8;
  runtime.activeInference.set('reuse', { id: 'reuse', priority: 'high', abort: () => {}, generation: 8 });

  assert.strictEqual(coordinator.complete('reuse', 7), false, 'runtime generation mismatch must fail closed');
  assert.strictEqual(runtime.activeInference.get('reuse').generation, 8, 'new-generation runtime task must survive stale completion');
  assert.strictEqual(governor.active.has('reuse'), true, 'governor state must remain until reconciliation');
  assert.strictEqual(coordinator.active.has('reuse'), true, 'coordinator state must remain until reconciliation');

  const audit = coordinator.snapshot().completed.find(x => x.reason === 'runtime-generation-completion-blocked');
  assert.ok(audit, 'blocked completion must be observable');
  assert.strictEqual(audit.expectedGeneration, 7);
  assert.strictEqual(audit.runtimeGeneration, 8);
  assert.strictEqual(audit.runtimeReason, 'runtime-generation-mismatch');

  console.log('RUNTIME_COMPLETION_RUNTIME_GENERATION_GUARD_PASS');
})();
