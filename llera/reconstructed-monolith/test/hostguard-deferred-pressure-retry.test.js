'use strict';

const assert = require('assert');
const { HostguardRuntimeCoordinator } = require('../src/hostguard-runtime-coordinator');

class Governor {
  update() {
    return { state: 'critical', score: 0.97, policy: this.policy(), transition: null };
  }
  policy() {
    return {
      pressure: 'critical',
      downloadWorkers: 1,
      allowVisionLoad: false,
      unloadVision: true,
      preemptLowPriorityInference: true,
      runtimePriority: 'BelowNormal'
    };
  }
}

(async () => {
  const runtimeCalls = [];
  let pass = 0;
  const runtime = {
    async applyHostPressure(level) {
      runtimeCalls.push(level);
      pass += 1;
      if (pass === 1) {
        return {
          level,
          aborted: [],
          failures: [],
          deferred: true,
          reason: 'model-switch:test-a->test-b'
        };
      }
      return {
        level,
        aborted: ['council-survivor'],
        failures: [],
        deferred: false
      };
    }
  };

  const inferencePressure = [];
  const inferenceGovernor = {
    async applyPressure(level) {
      inferencePressure.push(level);
      return { profile: { pressure: level }, preemptionCandidates: [{ id: 'council-survivor' }] };
    },
    snapshot() { return { pressure: inferencePressure[inferencePressure.length - 1] || 'normal' }; }
  };

  const reconciled = [];
  const inferenceCoordinator = {
    reconcileRuntimeAborts(ids, { reason }) {
      reconciled.push({ ids: [...ids], reason });
      return ids.map(id => ({ id }));
    }
  };

  const unloads = [];
  const workers = [];
  const coordinator = new HostguardRuntimeCoordinator({
    governor: new Governor(),
    runtime,
    inferenceGovernor,
    inferenceCoordinator,
    vision: { unload: async reason => unloads.push(reason) },
    downloader: { setWorkers: async count => workers.push(count) }
  });

  const first = await coordinator.sample({});
  const firstPressure = first.actions.find(action => action.type === 'runtime-pressure');
  assert(firstPressure, 'first CRITICAL sample must attempt runtime pressure');
  assert.strictEqual(firstPressure.deferred, true);
  assert(first.actions.some(action => action.type === 'runtime-pressure-retry-pending'));
  assert.strictEqual(coordinator.status().lastApplied.pressure, null, 'deferred pressure must not be cached as applied');
  assert.strictEqual(coordinator.status().lastApplied.inferencePressure, 'critical', 'admission fence must remain CRITICAL while retry is pending');

  const second = await coordinator.sample({});
  const secondPressure = second.actions.find(action => action.type === 'runtime-pressure');
  assert(secondPressure, 'same CRITICAL pressure must retry after a deferred pass');
  assert.strictEqual(secondPressure.deferred, false);
  assert.deepStrictEqual(secondPressure.aborted, ['council-survivor']);
  assert.strictEqual(coordinator.status().lastApplied.pressure, 'critical');
  assert.deepStrictEqual(runtimeCalls, ['critical', 'critical']);
  assert.deepStrictEqual(inferencePressure, ['critical'], 'retry must not reopen or churn inference admission policy');
  assert.deepStrictEqual(reconciled, [{ ids: ['council-survivor'], reason: 'host-pressure-critical' }]);
  assert.deepStrictEqual(unloads, ['host-pressure-critical'], 'Vision unload latch must remain one-shot across retry');
  assert.deepStrictEqual(workers, [1], 'adaptive worker policy must not churn across retry');

  await coordinator.sample({});
  assert.deepStrictEqual(runtimeCalls, ['critical', 'critical'], 'successful retry must latch CRITICAL pressure');

  console.log('HOSTGUARD_DEFERRED_PRESSURE_RETRY_PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
