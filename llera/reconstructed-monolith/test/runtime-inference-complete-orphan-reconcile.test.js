'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RuntimeInferenceCoordinator } = require('../src/runtime-inference-coordinator');

test('completion reconciles external-death cleanup before returning stale completion', () => {
  let cleanup = null;
  const runtimeActive = new Set();
  const governorActive = new Set();

  const runtime = {
    registerInference(id) {
      runtimeActive.add(id);
      return { id, generation: 7 };
    },
    completeInference(id) {
      return runtimeActive.delete(id);
    },
    snapshot() {
      return {
        generation: 7,
        lastOrphanedInferenceCleanup: cleanup
      };
    }
  };

  const governor = {
    admit({ id, className }) {
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
    }
  };

  const coordinator = new RuntimeInferenceCoordinator({ runtime, governor });
  const admitted = coordinator.begin({ id: 'chat-dead-runtime', abort: async () => {} });
  assert.equal(admitted.allow, true);
  assert.equal(governorActive.has('chat-dead-runtime'), true);

  // RuntimeLifecycle independently discovered that llama.cpp died and removed the
  // inference. The consumer races in with its normal completion before any new
  // inference is admitted.
  runtimeActive.delete('chat-dead-runtime');
  cleanup = {
    at: 2000,
    reason: 'runtime-external-death:health-watch',
    aborted: ['chat-dead-runtime'],
    failures: []
  };

  assert.equal(coordinator.complete('chat-dead-runtime', admitted.generation), false);
  assert.equal(governorActive.has('chat-dead-runtime'), false);
  assert.equal(coordinator.snapshot().active.length, 0);
  assert.ok(coordinator.snapshot().completed.some(item =>
    item.id === 'chat-dead-runtime' && item.reason === 'runtime-external-death:health-watch'
  ));
});
