'use strict';

const assert = require('assert');
const { RuntimeLifecycle } = require('../src/runtime-lifecycle');

async function run() {
  let nextPid = 7000;
  const starts = [];
  const stops = [];
  const aborts = [];
  let failAbort = true;

  const runtime = new RuntimeLifecycle({
    start: async ({ model, generation }) => {
      const pid = ++nextPid;
      starts.push({ model, generation, pid });
      return { pid };
    },
    stop: async ({ pid, model, reason }) => {
      stops.push({ pid, model, reason });
    },
    health: async () => true,
    now: (() => { let t = 1000; return () => ++t; })()
  });

  await runtime.ensureRunning('qwen3-next-80b-q4km');
  const original = runtime.snapshot();

  runtime.registerInference('interactive-live', {
    priority: 'normal',
    abort: async (reason) => {
      aborts.push({ id: 'interactive-live', reason });
      if (failAbort) throw new Error('simulated abort refusal');
    }
  });
  runtime.registerInference('background-live', {
    priority: 'low',
    abort: async (reason) => {
      aborts.push({ id: 'background-live', reason });
    }
  });

  await assert.rejects(
    () => runtime.recover('health-drop-with-live-inference'),
    /inference drain failed: interactive-live/
  );

  let s = runtime.snapshot();
  assert.strictEqual(s.state, 'ready', 'failed drain must not transition runtime away from ready');
  assert.strictEqual(s.pid, original.pid, 'failed drain must preserve original backend pid');
  assert.strictEqual(s.model, original.model, 'failed drain must preserve original model');
  assert.strictEqual(s.generation, original.generation, 'failed drain must not advance generation');
  assert.deepStrictEqual(s.activeInference.map(x => x.id), ['interactive-live'], 'successfully drained task may leave, failed task must remain tracked');
  assert.strictEqual(stops.length, 0, 'backend must not stop while an inference abort is unresolved');
  assert.strictEqual(starts.length, 1, 'failed recovery drain must not launch another runtime');
  assert.match(String(s.lastError || ''), /recovery inference drain failed/);

  failAbort = false;
  s = await runtime.recover('health-drop-after-reconcile');

  assert.strictEqual(s.state, 'ready');
  assert.strictEqual(s.model, 'qwen3-next-80b-q4km');
  assert.strictEqual(s.generation, original.generation + 1);
  assert.strictEqual(s.recoveryCount, 1);
  assert.strictEqual(s.activeInference.length, 0);
  assert.strictEqual(stops.length, 1, 'resolved recovery must stop exactly the old backend');
  assert.strictEqual(stops[0].pid, original.pid);
  assert.strictEqual(starts.length, 2, 'resolved recovery may launch exactly one replacement runtime');
  assert.notStrictEqual(s.pid, original.pid);

  const retryAbort = aborts.filter(x => x.id === 'interactive-live');
  assert.strictEqual(retryAbort.length, 2, 'unresolved inference must be retried explicitly on later recovery');
  assert(aborts.some(x => x.id === 'background-live'), 'other tracked inference must still be drained even if one abort fails');

  console.log('MONOLITH runtime recovery inference drain PASS', {
    failClosedOnAbortFailure: true,
    backendPreservedUntilDrainResolved: true,
    unresolvedInferenceRemainsTracked: true,
    noSecondRuntimeOnFailedDrain: true,
    recoveryAfterReconcile: true
  });
}

run().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
