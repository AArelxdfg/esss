'use strict';
const assert = require('assert');
const { RuntimeLifecycle } = require('../src/runtime-lifecycle');

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

(async () => {
  const launchGate = deferred();
  const launchObserved = deferred();
  const events = [];
  let live = 0;
  let maxLive = 0;
  let nextPid = 900;
  const runtime = new RuntimeLifecycle({
    start: async ({ model }) => {
      events.push(`start:${model}`);
      live += 1;
      maxLive = Math.max(maxLive, live);
      launchObserved.resolve();
      await launchGate.promise;
      return { pid:++nextPid };
    },
    health: async ({ model }) => { events.push(`health:${model}`); return true; },
    stop: async ({ model }) => { events.push(`stop:${model}`); live -= 1; }
  });

  const starting = runtime.ensureRunning('model-a', 'serialized-start');
  await launchObserved.promise;
  const stopping = runtime.stop('stop-during-start');
  const pressure = await runtime.applyHostPressure('CRITICAL');
  assert.strictEqual(pressure.deferred, true, 'pressure preemption must defer during a lifecycle transition');
  assert.throws(() => runtime.registerInference('during-start', { abort:async () => {} }), /transition in progress/);
  assert.strictEqual(events.includes('stop:model-a'), false, 'stop must wait for the active start owner');
  launchGate.resolve();
  await starting;
  const stopped = await stopping;
  assert.strictEqual(stopped.state, 'stopped');
  assert.deepStrictEqual(events, ['start:model-a','health:model-a','stop:model-a']);
  assert.strictEqual(maxLive, 1);
  assert.ok(runtime.transitionLog.every(entry => typeof entry.owner === 'string' && entry.owner.length > 0));
  assert.throws(() => runtime._transition('starting', 'unauthorized'), error => error.code === 'RUNTIME_TRANSITION_OWNER_REQUIRED');

  let concurrentLive = 0;
  let concurrentMax = 0;
  let concurrentPid = 1000;
  const switches = [];
  const serializedSwitch = new RuntimeLifecycle({
    start: async ({ model }) => { switches.push(`start:${model}`); concurrentLive += 1; concurrentMax = Math.max(concurrentMax, concurrentLive); return { pid:++concurrentPid }; },
    health: async () => true,
    stop: async ({ model }) => { switches.push(`stop:${model}`); concurrentLive -= 1; }
  });
  await Promise.all([
    serializedSwitch.ensureRunning('model-a', 'first-owner'),
    serializedSwitch.ensureRunning('model-b', 'second-owner')
  ]);
  const final = serializedSwitch.snapshot();
  assert.strictEqual(final.state, 'ready');
  assert.strictEqual(final.model, 'model-b');
  assert.strictEqual(final.desiredModel, 'model-b');
  assert.strictEqual(concurrentMax, 1);
  assert.deepStrictEqual(switches, ['start:model-a','stop:model-a','start:model-b']);

  console.log('runtime transition serialization PASS', {
    stopDuringStartSerialized:true,
    transitionOwnerRequired:true,
    inferenceClosedDuringTransition:true,
    pressureDeferredDuringTransition:true,
    concurrentSwitchSerialized:true,
    desiredEqualsActual:true,
    maxLiveRuntimes:concurrentMax
  });
})().catch(error => { console.error(error); process.exit(1); });
