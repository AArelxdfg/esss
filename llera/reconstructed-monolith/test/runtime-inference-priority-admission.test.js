'use strict';

const assert = require('assert');
const { RuntimeLifecycle } = require('../src/runtime-lifecycle');

(async () => {
  let pid = 900;
  const runtime = new RuntimeLifecycle({
    start: async ({ model, generation }) => ({ pid: pid++, model, generation }),
    stop: async () => {},
    health: async () => true,
    now: (() => { let n = 1; return () => n++; })()
  });

  await runtime.ensureRunning('model-a');

  const aborted = [];
  const low = runtime.registerInference('mixed-low', {
    priority: '  LoW\t',
    abort: async reason => { aborted.push(['mixed-low', reason]); }
  });
  const high = runtime.registerInference('mixed-high', {
    priority: ' HIGH ',
    abort: async reason => { aborted.push(['mixed-high', reason]); }
  });

  assert.strictEqual(low.priority, 'low');
  assert.strictEqual(high.priority, 'high');
  assert.deepStrictEqual(runtime.snapshot().activeInference.map(x => x.priority), ['low', 'high']);

  const pressure = await runtime.applyHostPressure('critical');
  assert.deepStrictEqual(pressure.aborted, ['mixed-low']);
  assert.deepStrictEqual(aborted, [['mixed-low', 'host-pressure-critical']]);
  assert.ok(runtime.activeInference.has('mixed-high'), 'high-priority inference must survive low-only CRITICAL preemption');

  assert.throws(
    () => runtime.registerInference('unknown-priority', { priority: 'background-ish', abort: async () => {} }),
    error => error && error.code === 'RUNTIME_INVALID_INFERENCE_PRIORITY'
  );
  assert.ok(!runtime.activeInference.has('unknown-priority'), 'invalid priority must fail before inference admission');

  console.log('MONOLITH runtime inference priority admission PASS', {
    priorityCanonicalization: true,
    criticalPreemptionCannotBeBypassedByCasing: true,
    invalidPriorityFailsClosed: true
  });
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
