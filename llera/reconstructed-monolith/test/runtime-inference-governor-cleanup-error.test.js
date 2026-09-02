'use strict';

const assert = require('assert');
const { RuntimeInferenceCoordinator } = require('../src/runtime-inference-coordinator');

function run() {
  const runtime = {
    registerInference() {
      const error = new Error('runtime transition in progress');
      error.code = 'RUNTIME_TRANSITION_IN_PROGRESS';
      throw error;
    },
    completeInference() {
      return false;
    },
    snapshot() {
      return { activeInference: [], lastOrphanedInferenceCleanup: null };
    }
  };

  const governor = {
    admit({ id, className }) {
      return {
        allow: true,
        id,
        className,
        maxTokens: 1024,
        reasoning: 'minimal',
        pressure: 'normal',
        startedAt: 10
      };
    },
    complete() {
      throw new Error('governor cleanup transport failed');
    }
  };

  const coordinator = new RuntimeInferenceCoordinator({ runtime, governor });

  let observed = null;
  try {
    coordinator.begin({ id: 'admission-cleanup-failure', abort: async () => {} });
  } catch (error) {
    observed = error;
  }

  assert.ok(observed, 'runtime registration failure must be surfaced');
  assert.equal(observed.code, 'RUNTIME_TRANSITION_IN_PROGRESS', 'cleanup failure must not mask the authoritative runtime failure');
  assert.equal(observed.message, 'runtime transition in progress');
  assert.equal(observed.cleanupDegraded, true, 'cleanup degradation must be explicit');
  assert.equal(observed.governorCleanupError, 'governor cleanup transport failed');
  assert.equal(coordinator.snapshot().active.length, 0, 'failed admission must not be retained locally');

  console.log(JSON.stringify({
    pass: true,
    originalAdmissionErrorPreserved: true,
    governorCleanupFailureObserved: true,
    localAdmissionNotRetained: true
  }));
}

try {
  run();
} catch (error) {
  console.error(error.stack || error);
  process.exit(1);
}
