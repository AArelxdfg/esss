'use strict';

const assert = require('assert');
const { RuntimeLifecycle } = require('../src/runtime-lifecycle');

(async () => {
  let pid = 400;
  const runtime = new RuntimeLifecycle({
    start: async ({ model, generation }) => ({ pid: pid++, model, generation }),
    stop: async () => {},
    health: async () => true,
    now: (() => { let n = 1; return () => n++; })()
  });

  await runtime.ensureRunning('model-a');

  const aborted = [];
  runtime.registerInference('low-whitespace', {
    priority: 'low',
    abort: async reason => { aborted.push(['low-whitespace', reason]); }
  });
  runtime.registerInference('normal-whitespace', {
    priority: 'normal',
    abort: async reason => { aborted.push(['normal-whitespace', reason]); }
  });

  const whitespace = await runtime.applyHostPressure('  critical  ');
  assert.strictEqual(whitespace.level, 'CRITICAL');
  assert.deepStrictEqual(whitespace.aborted, ['low-whitespace']);
  assert.deepStrictEqual(whitespace.failures, []);
  assert.deepStrictEqual(aborted, [['low-whitespace', 'host-pressure-critical']]);
  assert.ok(runtime.activeInference.has('normal-whitespace'), 'normal-priority inference must survive CRITICAL preemption');

  runtime.registerInference('low-mixed-case', {
    priority: 'low',
    abort: async reason => { aborted.push(['low-mixed-case', reason]); }
  });
  const mixedCase = await runtime.applyHostPressure('\tCrItIcAl\r\n');
  assert.strictEqual(mixedCase.level, 'CRITICAL');
  assert.deepStrictEqual(mixedCase.aborted, ['low-mixed-case']);
  assert.deepStrictEqual(mixedCase.failures, []);

  runtime.registerInference('low-warning', {
    priority: 'low',
    abort: async reason => { aborted.push(['low-warning', reason]); }
  });
  const warning = await runtime.applyHostPressure(' warning ');
  assert.strictEqual(warning.level, 'WARNING');
  assert.deepStrictEqual(warning.aborted, []);
  assert.ok(runtime.activeInference.has('low-warning'), 'non-critical pressure must not preempt low-priority inference');

  console.log('MONOLITH runtime HOSTGUARD pressure normalization PASS', {
    whitespaceCriticalCanonicalized: true,
    mixedCaseCriticalCanonicalized: true,
    lowPriorityPreempted: true,
    normalPriorityPreserved: true,
    nonCriticalPreserved: true
  });
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
