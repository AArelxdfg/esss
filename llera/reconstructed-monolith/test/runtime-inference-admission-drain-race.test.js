'use strict';

const assert = require('assert');
const { RuntimeLifecycle } = require('../src/runtime-lifecycle');

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

async function makeReadyRuntime(model = 'model-a') {
  let nextPid = 3000;
  const starts = [];
  const stops = [];
  const runtime = new RuntimeLifecycle({
    start: async ({ model, generation }) => {
      const started = { pid: ++nextPid, model, generation };
      starts.push(started);
      return started;
    },
    stop: async info => { stops.push({ ...info }); },
    health: async () => true
  });
  await runtime.ensureRunning(model, 'test-start');
  return { runtime, starts, stops };
}

function assertAdmissionClosed(runtime, id) {
  assert.throws(
    () => runtime.registerInference(id, { abort: async () => {} }),
    err => err && err.code === 'RUNTIME_INFERENCE_ADMISSION_CLOSED'
  );
}

async function stopRace() {
  const { runtime, starts, stops } = await makeReadyRuntime();
  const abortEntered = deferred();
  const releaseAbort = deferred();
  runtime.registerInference('stop-active', {
    abort: async () => {
      abortEntered.resolve();
      await releaseAbort.promise;
    }
  });

  const stopping = runtime.stop('race-stop');
  await abortEntered.promise;
  assert.strictEqual(runtime.snapshot().inferenceAdmissionClosed, true);
  assertAdmissionClosed(runtime, 'stop-late');
  assert.strictEqual(stops.length, 0, 'backend must not stop before drain completes');

  releaseAbort.resolve();
  const stopped = await stopping;
  assert.strictEqual(stopped.state, 'stopped');
  assert.strictEqual(stopped.activeInference.length, 0);
  assert.strictEqual(stops.length, 1);
  assert.strictEqual(starts.length, 1, 'stop race must never launch another backend');
}

async function recoveryRace() {
  const { runtime, starts, stops } = await makeReadyRuntime();
  const abortEntered = deferred();
  const releaseAbort = deferred();
  runtime.registerInference('recover-active', {
    abort: async () => {
      abortEntered.resolve();
      await releaseAbort.promise;
    }
  });

  const recovering = runtime.recover('race-health-drop');
  await abortEntered.promise;
  assert.strictEqual(runtime.snapshot().inferenceAdmissionClosed, true);
  assertAdmissionClosed(runtime, 'recover-late');
  assert.strictEqual(stops.length, 0, 'recovery backend stop must wait for drain');

  releaseAbort.resolve();
  const recovered = await recovering;
  assert.strictEqual(recovered.state, 'ready');
  assert.strictEqual(recovered.activeInference.length, 0);
  assert.strictEqual(recovered.inferenceAdmissionClosed, false);
  assert.strictEqual(stops.length, 1);
  assert.strictEqual(starts.length, 2, 'recovery must replace backend exactly once');
}

async function modelSwitchRace() {
  const { runtime, starts, stops } = await makeReadyRuntime('model-a');
  const abortEntered = deferred();
  const releaseAbort = deferred();
  runtime.registerInference('switch-active', {
    abort: async () => {
      abortEntered.resolve();
      await releaseAbort.promise;
    }
  });

  const switching = runtime.ensureRunning('model-b', 'race-model-switch');
  await abortEntered.promise;
  assert.strictEqual(runtime.snapshot().inferenceAdmissionClosed, true);
  assertAdmissionClosed(runtime, 'switch-late');
  await assert.rejects(
    () => runtime.ensureRunning('model-a', 'concurrent-ensure'),
    err => err && err.code === 'RUNTIME_TRANSITION_IN_PROGRESS'
  );
  assert.strictEqual(stops.length, 0, 'model switch stop must wait for drain');

  releaseAbort.resolve();
  const switched = await switching;
  assert.strictEqual(switched.state, 'ready');
  assert.strictEqual(switched.model, 'model-b');
  assert.strictEqual(switched.activeInference.length, 0);
  assert.strictEqual(switched.inferenceAdmissionClosed, false);
  assert.strictEqual(stops.length, 1);
  assert.strictEqual(starts.length, 2, 'model switch must preserve single-runtime start/stop ordering');
}

(async () => {
  await stopRace();
  await recoveryRace();
  await modelSwitchRace();
  console.log('runtime inference admission drain race PASS', {
    stopAdmissionClosedBeforeDrainSnapshot:true,
    recoveryAdmissionClosedBeforeDrainSnapshot:true,
    modelSwitchAdmissionClosedBeforeDrainSnapshot:true,
    concurrentEnsureBlockedDuringSwitch:true,
    lateInferenceNeverSilentlyDropped:true,
    singleRuntimeOrderingPreserved:true
  });
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
