'use strict';

const assert = require('assert');
const { RuntimeLifecycle } = require('../src/runtime-lifecycle');

async function run() {
  let nextPid = 2000;
  const events = [];
  const runtime = new RuntimeLifecycle({
    start: async ({ model }) => { events.push(`start:${model}`); return { pid: ++nextPid }; },
    stop: async ({ model }) => { events.push(`stop:${model}`); },
    health: async () => true,
    now: (() => { let n = 0; return () => ++n; })()
  });

  await runtime.ensureRunning('old-model');
  runtime.registerInference('interactive', {
    priority: 'normal',
    abort: async reason => events.push(`abort:interactive:${reason}`)
  });
  runtime.registerInference('background', {
    priority: 'low',
    abort: async reason => events.push(`abort:background:${reason}`)
  });

  await runtime.ensureRunning('new-model');

  const abortInteractive = events.indexOf('abort:interactive:model-switch:old-model->new-model');
  const abortBackground = events.indexOf('abort:background:model-switch:old-model->new-model');
  const stopOld = events.indexOf('stop:old-model');
  const startNew = events.indexOf('start:new-model');

  assert(abortInteractive >= 0);
  assert(abortBackground >= 0);
  assert(stopOld > abortInteractive);
  assert(stopOld > abortBackground);
  assert(startNew > stopOld);
  assert.strictEqual(runtime.snapshot().activeInference.length, 0);
  assert.strictEqual(runtime.snapshot().model, 'new-model');

  const guarded = new RuntimeLifecycle({
    start: async ({ model }) => ({ pid: model === 'old' ? 3001 : 3002 }),
    stop: async () => {},
    health: async () => true
  });
  await guarded.ensureRunning('old');
  guarded.registerInference('cannot-drain', {
    abort: async () => { throw new Error('abort refused'); }
  });

  await assert.rejects(
    guarded.ensureRunning('new'),
    /inference drain failed/
  );
  assert.strictEqual(guarded.snapshot().model, 'old');
  assert.strictEqual(guarded.snapshot().state, 'ready');
  assert.deepStrictEqual(guarded.snapshot().activeInference.map(x => x.id), ['cannot-drain']);

  console.log('runtime switch drain PASS', {
    drainBeforeStop: true,
    allPrioritiesDrained: true,
    failedDrainKeepsOldRuntime: true,
    singleRuntime: true
  });
}

run().catch(err => {
  console.error(err.stack || err);
  process.exit(1);
});
