'use strict';

const assert = require('assert');
const { RuntimeInferenceCoordinator } = require('../src/runtime-inference-coordinator');

function run() {
  const runtimeActive = new Map();
  const governorActive = new Set();
  const runtimeCompletions = [];
  const governorCompletions = [];

  const runtime = {
    registerInference(id) {
      runtimeActive.set(id, { id, generation: 7 });
      // Simulate a malformed wrapper return after the underlying runtime has already
      // registered the inference. The coordinator must not strand the runtime slot.
      return { id, generation: null };
    },
    completeInference(id, generation) {
      runtimeCompletions.push({ id, generation });
      const task = runtimeActive.get(id);
      if (!task || task.generation !== generation) return false;
      return runtimeActive.delete(id);
    },
    snapshot() {
      return {
        activeInference: [...runtimeActive.values()].map(item => ({ ...item })),
        lastOrphanedInferenceCleanup: null
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
        maxTokens: 1024,
        reasoning: 'minimal',
        pressure: 'normal',
        startedAt: 100
      };
    },
    complete(id) {
      governorCompletions.push(id);
      return governorActive.delete(id);
    },
    snapshot() {
      return { active: [...governorActive] };
    }
  };

  const coordinator = new RuntimeInferenceCoordinator({ runtime, governor });

  assert.throws(
    () => coordinator.begin({ id: 'malformed-registration', abort: async () => {} }),
    error => error && error.code === 'RUNTIME_INFERENCE_GENERATION_REQUIRED'
  );

  assert.equal(runtimeActive.size, 0, 'failed admission must roll back the underlying runtime registration');
  assert.equal(governorActive.size, 0, 'failed admission must release the governor slot');
  assert.deepEqual(runtimeCompletions, [{ id: 'malformed-registration', generation: 7 }]);
  assert.deepEqual(governorCompletions, ['malformed-registration']);
  assert.equal(coordinator.snapshot().active.length, 0, 'coordinator must not retain a failed admission');

  console.log(JSON.stringify({
    pass: true,
    runtimeRegistrationRolledBack: true,
    governorAdmissionRolledBack: true,
    orphanSlotPrevented: true
  }));
}

try {
  run();
} catch (error) {
  console.error(error.stack || error);
  process.exit(1);
}
