'use strict';

const assert = require('assert');
const { RuntimeLifecycle } = require('../src/runtime-lifecycle');

async function run() {
  let nextPid = 1000;
  const starts = [];
  const stops = [];
  const health = [];
  const aborted = [];
  let now = 100;

  const runtime = new RuntimeLifecycle({
    start: async ({ model, generation }) => {
      starts.push({ model, generation });
      return { pid: ++nextPid };
    },
    stop: async ({ pid, model }) => { stops.push({ pid, model }); },
    health: async ({ pid, model }) => { health.push({ pid, model }); return true; },
    now: () => ++now
  });

  let s = await runtime.ensureRunning('qwen3-next-80b-q4km');
  assert.equal(s.state, 'ready');
  assert.equal(s.model, 'qwen3-next-80b-q4km');
  assert.equal(starts.length, 1);
  assert.equal(health.length, 1);

  await runtime.ensureRunning('qwen3-next-80b-q4km');
  assert.equal(starts.length, 1);

  runtime.registerInference('interactive-1', { priority: 'normal', abort: async () => aborted.push('interactive-1') });
  runtime.registerInference('council-1', { priority: 'low', abort: async () => aborted.push('council-1') });
  runtime.registerInference('adversarial-1', { priority: 'low', abort: async () => aborted.push('adversarial-1') });

  const pressure = await runtime.applyHostPressure('CRITICAL');
  assert.deepEqual(pressure.aborted, ['council-1', 'adversarial-1']);
  assert.deepEqual(pressure.failures, []);
  assert.deepEqual(aborted, ['council-1', 'adversarial-1']);
  assert.deepEqual(runtime.snapshot().activeInference.map(x => x.id), ['interactive-1']);

  await runtime.ensureRunning('gpt-oss-20b-mxfp4');
  assert.equal(stops.length, 1);
  assert.equal(stops[0].model, 'qwen3-next-80b-q4km');
  assert.equal(starts.length, 2);
  assert.equal(runtime.snapshot().model, 'gpt-oss-20b-mxfp4');

  runtime.registerInference('background-2', { priority: 'low', abort: async () => aborted.push('background-2') });
  const preRecoveryGeneration = runtime.snapshot().generation;
  s = await runtime.recover('simulated-health-drop');
  assert.equal(s.state, 'ready');
  assert.equal(s.model, 'gpt-oss-20b-mxfp4');
  assert.equal(s.generation, preRecoveryGeneration + 1);
  assert.equal(s.recoveryCount, 1);
  assert.equal(s.activeInference.length, 0);
  assert.equal(starts.length, 3);
  assert.equal(stops.length, 2);

  const pairs = runtime.transitionLog.map(x => `${x.from}->${x.to}`);
  assert(pairs.includes('ready->recovering'));
  assert(pairs.includes('recovering->starting'));
  assert(pairs.includes('starting->ready'));

  console.log(JSON.stringify({
    pass: true,
    singleRuntime: true,
    criticalPressurePreemption: true,
    interactiveInferencePreserved: true,
    modelSwitchStopBeforeStart: true,
    deterministicRecovery: true,
    starts: starts.length,
    stops: stops.length,
    generation: s.generation
  }));
}

run().catch(err => {
  console.error(err.stack || err);
  process.exit(1);
});
