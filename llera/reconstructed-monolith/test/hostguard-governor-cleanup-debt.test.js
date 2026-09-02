'use strict';
const assert = require('assert');
const { RuntimeInferenceCoordinator } = require('../src/runtime-inference-coordinator');

(async()=>{
  const runtimeTasks = new Map();
  const governorActive = new Set();
  let generation = 0;
  let failCleanupOnce = true;
  const runtime = {
    registerInference(id, { priority, abort }) {
      generation += 1;
      runtimeTasks.set(id, { generation, priority, abort });
      return { generation };
    },
    completeInference(id, taskGeneration) {
      const task = runtimeTasks.get(id);
      if (!task || task.generation !== taskGeneration) return false;
      runtimeTasks.delete(id);
      return true;
    },
    snapshot() { return { activeInference: [...runtimeTasks].map(([id, task]) => ({ id, generation: task.generation })) }; }
  };
  const governor = {
    admit({ id, className }) {
      governorActive.add(id);
      return { allow: true, id, className, maxTokens: 1024, reasoning: 'normal', pressure: 'normal', startedAt: 1 };
    },
    complete(id) {
      if (id === 'council-leak' && failCleanupOnce) {
        failCleanupOnce = false;
        throw new Error('synthetic governor cleanup failure');
      }
      return governorActive.delete(id);
    },
    snapshot() { return { active: [...governorActive] }; }
  };

  const coordinator = new RuntimeInferenceCoordinator({ runtime, governor });
  const admitted = coordinator.begin({ id: 'council-leak', className: 'council', abort() {} });
  assert.strictEqual(admitted.allow, true);

  const reconciled = coordinator.reconcileRuntimeAborts(['council-leak'], { reason: 'host-pressure-critical' });
  assert.strictEqual(reconciled.length, 1);
  assert.strictEqual(reconciled[0].degraded, true);
  assert.strictEqual(coordinator.snapshot().active.length, 0);
  assert.strictEqual(coordinator.snapshot().governorCleanupDebt.length, 1);
  assert.deepStrictEqual([...governorActive], ['council-leak']);

  const next = coordinator.begin({ id: 'interactive-next', className: 'interactive', abort() {} });
  assert.strictEqual(next.allow, true);
  assert.strictEqual(coordinator.snapshot().governorCleanupDebt.length, 0);
  assert.deepStrictEqual([...governorActive], ['interactive-next']);
  assert.ok(coordinator.snapshot().completed.some(entry => entry.id === 'council-leak' && /retry-cleared$/.test(entry.reason)));

  coordinator.complete('interactive-next', next.generation);
  assert.strictEqual(governorActive.size, 0);
  assert.strictEqual(runtimeTasks.size, 0);

  console.log('HOSTGUARD governor cleanup debt recovery PASS', { cleanupDebtRecovered: true, capacityLeakPrevented: true });
})().catch(error => { console.error(error); process.exit(1); });
