'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RuntimeInferenceCoordinator } = require('../src/runtime-inference-coordinator');

test('runtime orphan reconciliation clears local state even when governor cleanup throws', () => {
  let cleanup = null;
  const governorActive = new Set();
  const runtime = {
    registerInference(id) {
      return { id, generation: 7 };
    },
    completeInference() {
      return true;
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
        maxTokens: 64,
        reasoning: false,
        pressure: 'NORMAL',
        startedAt: 1
      };
    },
    complete(id) {
      if (id === 'broken-governor') throw new Error('governor cleanup unavailable');
      return governorActive.delete(id);
    }
  };

  const coordinator = new RuntimeInferenceCoordinator({ runtime, governor });
  assert.equal(coordinator.begin({ id: 'broken-governor', abort: async () => {} }).allow, true);
  assert.equal(coordinator.begin({ id: 'healthy-governor', abort: async () => {} }).allow, true);

  cleanup = {
    generation: 7,
    at: 1234,
    reason: 'runtime-external-death:ensure-ready-probe',
    aborted: ['broken-governor', 'healthy-governor'],
    failures: []
  };

  const reconciled = coordinator._reconcileRuntimeCleanup();
  const snapshot = coordinator.snapshot();

  assert.equal(snapshot.active.length, 0, 'all local admission records must be cleared');
  assert.equal(governorActive.has('healthy-governor'), false, 'later cleanup entries must still run');
  assert.equal(reconciled.length, 2);

  const degraded = reconciled.find(item => item.id === 'broken-governor');
  assert.equal(degraded.degraded, true);
  assert.match(degraded.governorCleanupError, /governor cleanup unavailable/);

  const healthy = reconciled.find(item => item.id === 'healthy-governor');
  assert.equal(healthy.degraded, undefined);
  assert.equal(healthy.governorCleanupError, undefined);

  assert.deepEqual(coordinator._reconcileRuntimeCleanup(), [], 'same cleanup event must remain idempotent');
});
