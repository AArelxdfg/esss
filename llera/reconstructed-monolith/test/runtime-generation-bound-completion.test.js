'use strict';
const assert = require('assert');
const { RuntimeInferenceCoordinator } = require('../src/runtime-inference-coordinator');

class Governor {
  constructor() { this.active = new Map(); }
  admit({ id, className }) {
    if (this.active.has(id)) return { allow: false, reason: 'unique_inference_id_required' };
    const record = { allow: true, id, className, pressure: 'normal', maxTokens: 4096, reasoning: 'normal', startedAt: Date.now() };
    this.active.set(id, record);
    return record;
  }
  complete(id) { return this.active.delete(id); }
  snapshot() { return { active: [...this.active.keys()] }; }
}

class Runtime {
  constructor() { this.state = 'ready'; this.generation = 1; this.active = new Map(); }
  registerInference(id, { priority, abort }) {
    if (this.active.has(id)) throw new Error('unique inference id required');
    const task = { id, priority, abort, generation: this.generation };
    this.active.set(id, task);
    return task;
  }
  completeInference(id) { return this.active.delete(id); }
  snapshot() { return { state: this.state, generation: this.generation, activeInference: [...this.active.keys()] }; }
}

(() => {
  const runtime = new Runtime();
  const governor = new Governor();
  const coordinator = new RuntimeInferenceCoordinator({ runtime, governor });

  const first = coordinator.begin({ id: 'shared-id', className: 'interactive', abort: () => {} });
  assert.strictEqual(first.allow, true);
  assert.strictEqual(first.generation, 1);
  assert.strictEqual(coordinator.complete('shared-id', first.generation), true);

  runtime.generation = 2;
  const second = coordinator.begin({ id: 'shared-id', className: 'interactive', abort: () => {} });
  assert.strictEqual(second.allow, true);
  assert.strictEqual(second.generation, 2);

  assert.strictEqual(coordinator.complete('shared-id', first.generation), false, 'stale generation must not complete current inference');
  assert.strictEqual(runtime.active.has('shared-id'), true, 'stale completion must not remove runtime task');
  assert.strictEqual(governor.active.has('shared-id'), true, 'stale completion must not remove governor task');
  assert.strictEqual(coordinator.active.has('shared-id'), true, 'stale completion must not remove coordinator task');

  const staleAudit = coordinator.snapshot().completed.find(x => x.reason === 'stale-completion-ignored');
  assert.ok(staleAudit, 'stale completion must be observable');
  assert.strictEqual(staleAudit.expectedGeneration, 1);
  assert.strictEqual(staleAudit.activeGeneration, 2);

  assert.strictEqual(coordinator.complete('shared-id', second.generation), true);
  assert.strictEqual(runtime.active.has('shared-id'), false);
  assert.strictEqual(governor.active.has('shared-id'), false);
  assert.strictEqual(coordinator.active.has('shared-id'), false);

  console.log('RUNTIME_GENERATION_BOUND_COMPLETION_PASS');
})();
