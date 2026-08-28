'use strict';

const assert = require('assert');
const { HostguardRuntimeCoordinator } = require('../src/hostguard-runtime-coordinator');

class Governor {
  constructor() { this.state = 'normal'; }
  update(sample = {}) {
    this.state = sample.state || this.state;
    return { state: this.state, score: sample.score || 0, policy: this.policy() };
  }
  policy() {
    return {
      pressure: this.state,
      downloadWorkers: this.state === 'critical' ? 1 : 8,
      allowVisionLoad: this.state !== 'critical',
      unloadVision: this.state === 'critical',
      runtimePriority: 'BelowNormal'
    };
  }
}

(async () => {
  const reconciled = [];
  const coordinator = new HostguardRuntimeCoordinator({
    governor: new Governor(),
    runtime: {
      async applyHostPressure(level) {
        if (level !== 'critical') return { level, aborted: [], failures: [] };
        return {
          level,
          aborted: ['adv-ok'],
          failures: [{ id: 'council-broken', error: 'abort channel failed' }],
          degraded: true
        };
      }
    },
    inferenceCoordinator: {
      reconcileRuntimeAborts(ids, { reason }) {
        reconciled.push({ ids: [...ids], reason });
        return ids.map(id => ({ id }));
      }
    }
  });

  await coordinator.sample({ state: 'normal' });
  const critical = await coordinator.sample({ state: 'critical' });

  const pressure = critical.actions.find(x => x.type === 'runtime-pressure');
  assert.deepStrictEqual(pressure.aborted, ['adv-ok']);
  assert.deepStrictEqual(pressure.failures, [{ id: 'council-broken', error: 'abort channel failed' }]);
  assert.strictEqual(pressure.degraded, true);

  const degraded = critical.actions.find(x => x.type === 'inference-preemption-degraded');
  assert(degraded);
  assert.deepStrictEqual(degraded.failures, [{ id: 'council-broken', error: 'abort channel failed' }]);

  assert.deepStrictEqual(reconciled, [
    { ids: ['adv-ok'], reason: 'host-pressure-critical' }
  ]);

  console.log('MONOLITH HOSTGUARD preemption observability PASS', {
    partialAbortReconciled: true,
    failureSurfaced: true,
    degradedStateSurfaced: true
  });
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
