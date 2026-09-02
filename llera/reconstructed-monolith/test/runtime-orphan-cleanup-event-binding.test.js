'use strict';

const assert = require('assert');
const { RuntimeInferenceCoordinator } = require('../src/runtime-inference-coordinator');

class Governor {
  constructor() {
    this.active = new Map();
    this.completeCalls = [];
  }

  admit({ id, className = 'interactive', requestedTokens = 1024 }) {
    const admission = {
      allow: true,
      id,
      className,
      pressure: 'normal',
      maxTokens: requestedTokens,
      reasoning: 'normal',
      startedAt: 1
    };
    this.active.set(id, admission);
    return admission;
  }

  complete(id) {
    this.completeCalls.push(id);
    return this.active.delete(id);
  }
}

class Runtime {
  constructor() {
    this.generation = 7;
    this.cleanup = {
      reason: 'runtime-external-death:ensure-ready-probe',
      aborted: ['same-id'],
      failures: [],
      at: 1000
    };
    this.exit = {
      pid: 501,
      model: 'model.gguf',
      kind: 'external-dead',
      reason: 'ensure-ready-probe',
      at: 1000
    };
    this.active = new Map();
  }

  registerInference(id, { priority, abort }) {
    const task = { id, priority, abort, generation: this.generation };
    this.active.set(id, task);
    return task;
  }

  completeInference(id, generation) {
    const task = this.active.get(id);
    if (!task || task.generation !== generation) return false;
    return this.active.delete(id);
  }

  snapshot() {
    return {
      state: 'ready',
      generation: this.generation,
      lastBackendExit: { ...this.exit },
      lastOrphanedInferenceCleanup: {
        ...this.cleanup,
        aborted: [...this.cleanup.aborted],
        failures: [...this.cleanup.failures]
      }
    };
  }
}

(() => {
  const runtime = new Runtime();
  const governor = new Governor();
  const coordinator = new RuntimeInferenceCoordinator({ runtime, governor });

  coordinator.active.set('same-id', {
    id: 'same-id',
    className: 'interactive',
    generation: 7
  });
  governor.active.set('same-id', { id: 'same-id' });

  const first = coordinator._reconcileRuntimeCleanup();
  assert.strictEqual(first.length, 1);
  assert.strictEqual(governor.completeCalls.filter(id => id === 'same-id').length, 1);

  // Recovery advances the current runtime generation, but the persisted cleanup is
  // still the same backend-death event. It must not be replayed.
  runtime.generation = 8;
  const staleReplay = coordinator._reconcileRuntimeCleanup();
  assert.deepStrictEqual(staleReplay, []);
  assert.strictEqual(governor.completeCalls.filter(id => id === 'same-id').length, 1);

  // A second very fast death may have the same timestamp/reason/inference ID.
  // A new backend identity must still make it a distinct cleanup event.
  coordinator.active.set('same-id', {
    id: 'same-id',
    className: 'interactive',
    generation: 8
  });
  governor.active.set('same-id', { id: 'same-id' });
  runtime.exit = { ...runtime.exit, pid: 502 };

  const secondDeath = coordinator._reconcileRuntimeCleanup();
  assert.strictEqual(secondDeath.length, 1);
  assert.strictEqual(governor.completeCalls.filter(id => id === 'same-id').length, 2);

  console.log('runtime orphan cleanup event binding PASS', {
    staleCleanupNotReplayedAfterGenerationAdvance: true,
    sameTimestampSecondBackendDeathStillDistinct: true
  });
})();
