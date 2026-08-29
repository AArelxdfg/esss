'use strict';

const assert = require('assert');
const { RuntimeLifecycle } = require('../src/runtime-lifecycle');

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

(async () => {
  let nextPid = 100;
  const starts = [];
  const stops = [];
  const runtime = new RuntimeLifecycle({
    start: async ({ model, generation }) => {
      const result = { pid: nextPid++, model, generation };
      starts.push(result);
      return result;
    },
    stop: async request => { stops.push({ ...request }); },
    health: async () => true,
    now: (() => { let n = 1; return () => n++; })()
  });

  await runtime.ensureRunning('model-a');

  const drainEntered = deferred();
  const allowDrain = deferred();
  let abortCalls = 0;
  runtime.registerInference('low-1', {
    priority: 'low',
    abort: async reason => {
      abortCalls += 1;
      assert.match(reason, /stop-drain/);
      drainEntered.resolve();
      await allowDrain.promise;
    }
  });

  const stopping = runtime.stop('host-pressure-race');
  await drainEntered.promise;

  const pressureDuringStop = await runtime.applyHostPressure('CRITICAL');
  assert.strictEqual(pressureDuringStop.deferred, true);
  assert.deepStrictEqual(pressureDuringStop.aborted, []);
  assert.deepStrictEqual(pressureDuringStop.failures, []);
  assert.match(pressureDuringStop.reason, /stop:/);
  assert.strictEqual(abortCalls, 1, 'HOSTGUARD must not double-abort a lifecycle-owned inference');
  assert.strictEqual(stops.length, 0, 'backend cannot stop before lifecycle drain completes');

  allowDrain.resolve();
  await stopping;
  assert.strictEqual(abortCalls, 1);
  assert.strictEqual(stops.length, 1);
  assert.strictEqual(runtime.state, 'stopped');

  await runtime.ensureRunning('model-a');
  let normalPressureAbortCalls = 0;
  runtime.registerInference('low-2', {
    priority: 'low',
    abort: async reason => {
      normalPressureAbortCalls += 1;
      assert.strictEqual(reason, 'host-pressure-critical');
    }
  });
  const pressureReady = await runtime.applyHostPressure('CRITICAL');
  assert.strictEqual(pressureReady.deferred, undefined);
  assert.deepStrictEqual(pressureReady.aborted, ['low-2']);
  assert.deepStrictEqual(pressureReady.failures, []);
  assert.strictEqual(normalPressureAbortCalls, 1, 'HOSTGUARD preemption must still work when no lifecycle transition owns cancellation');

  console.log('MONOLITH runtime HOSTGUARD drain serialization PASS', {
    lifecycleOwnsAbortDuringTransition: true,
    criticalPressureDeferredDuringDrain: true,
    noDoubleAbort: true,
    backendStopWaitsForDrain: true,
    standaloneCriticalPreemptionPreserved: true,
    singleRuntimeStarts: starts.length
  });
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
