'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RuntimeInferenceCoordinator } = require('../src/runtime-inference-coordinator');

test('coordinator releases stale governor admission after RuntimeLifecycle orphan cleanup', () => {
  let cleanup = null;
  const runtimeActive = new Set();
  const governorActive = new Set();

  const runtime = {
    registerInference(id) {
      runtimeActive.add(id);
      return { id, generation: cleanup ? 2 : 1 };
    },
    completeInference(id) {
      return runtimeActive.delete(id);
    },
    snapshot() {
      return { lastOrphanedInferenceCleanup: cleanup };
    }
  };

  const governor = {
    admit({ id, className }) {
      if (governorActive.size >= 1) return { allow: false, reason: 'capacity' };
      governorActive.add(id);
      return {
        allow: true,
        id,
        className,
        maxTokens: 128,
        reasoning: false,
        pressure: 'NORMAL',
        startedAt: 1
      };
    },
    complete(id) {
      return governorActive.delete(id);
    },
    snapshot() {
      return { active: [...governorActive] };
    }
  };

  const coordinator = new RuntimeInferenceCoordinator({ runtime, governor });
  const first = coordinator.begin({ id: 'stale-chat', abort: async () => {} });
  assert.equal(first.allow, true);
  assert.deepEqual([...governorActive], ['stale-chat']);

  // RuntimeLifecycle has detected a dead llama.cpp process and has already removed
  // its own inference record. The coordinator/governor must converge before the
  // next admission or the stale slot would reject all future inference.
  runtimeActive.delete('stale-chat');
  cleanup = {
    at: 42,
    reason: 'runtime-external-death:ensure-ready-probe',
    aborted: ['stale-chat'],
    failures: []
  };

  const second = coordinator.begin({ id: 'fresh-chat', abort: async () => {} });
  assert.equal(second.allow, true);
  assert.deepEqual([...governorActive], ['fresh-chat']);

  const snapshot = coordinator.snapshot();
  assert.deepEqual(snapshot.active.map(item => item.id), ['fresh-chat']);
  assert.ok(snapshot.completed.some(item =>
    item.id === 'stale-chat' && item.reason === 'runtime-external-death:ensure-ready-probe'
  ));
});

test('orphan cleanup abort failures also release stale coordinator/governor state exactly once', () => {
  let cleanup = null;
  const completed = [];
  const runtime = {
    registerInference(id) { return { id, generation: 1 }; },
    completeInference() { return true; },
    snapshot() { return { lastOrphanedInferenceCleanup: cleanup }; }
  };
  const governor = {
    active: new Set(),
    admit({ id, className }) {
      this.active.add(id);
      return { allow: true, className, maxTokens: 64, reasoning: false, pressure: 'NORMAL', startedAt: 1 };
    },
    complete(id) {
      completed.push(id);
      return this.active.delete(id);
    }
  };

  const coordinator = new RuntimeInferenceCoordinator({ runtime, governor });
  coordinator.begin({ id: 'broken-consumer', abort: async () => {} });
  cleanup = {
    at: 99,
    reason: 'runtime-external-death:ensure-ready-probe',
    aborted: [],
    failures: [{ id: 'broken-consumer', error: 'consumer already gone' }]
  };

  coordinator._reconcileRuntimeCleanup();
  coordinator._reconcileRuntimeCleanup();

  assert.equal(coordinator.snapshot().active.length, 0);
  assert.equal(completed.filter(id => id === 'broken-consumer').length, 1);
  assert.equal(coordinator.snapshot().completed.filter(item => item.id === 'broken-consumer').length, 1);
});
