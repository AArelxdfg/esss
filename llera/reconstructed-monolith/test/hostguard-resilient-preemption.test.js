'use strict';

const assert = require('assert');
const { RuntimeLifecycle } = require('../src/runtime-lifecycle');

(async () => {
  let now = 1000;
  const attempts = [];
  const runtime = new RuntimeLifecycle({
    start: async () => ({ pid: 77 }),
    stop: async () => {},
    health: async () => true,
    now: () => ++now
  });

  await runtime.ensureRunning('qwen3-next-80b-q4km');

  runtime.registerInference('interactive', {
    priority: 'normal',
    abort: async () => { throw new Error('interactive must not be touched'); }
  });
  runtime.registerInference('council-broken', {
    priority: 'low',
    abort: async reason => {
      attempts.push(['council-broken', reason]);
      throw new Error('abort channel failed');
    }
  });
  runtime.registerInference('adversarial-ok', {
    priority: 'low',
    abort: async reason => {
      attempts.push(['adversarial-ok', reason]);
    }
  });
  runtime.registerInference('council-ok', {
    priority: 'low',
    abort: async reason => {
      attempts.push(['council-ok', reason]);
    }
  });

  const result = await runtime.applyHostPressure('critical');

  assert.deepStrictEqual(attempts.map(x => x[0]), [
    'council-broken',
    'adversarial-ok',
    'council-ok'
  ]);
  assert.deepStrictEqual(result.aborted, ['adversarial-ok', 'council-ok']);
  assert.deepStrictEqual(result.failures, [
    { id: 'council-broken', error: 'abort channel failed' }
  ]);
  assert.strictEqual(result.degraded, true);

  const active = runtime.snapshot().activeInference.map(x => x.id);
  assert.deepStrictEqual(active, ['interactive', 'council-broken']);

  const normal = await runtime.applyHostPressure('normal');
  assert.deepStrictEqual(normal, { level: 'NORMAL', aborted: [], failures: [] });

  console.log('MONOLITH HOSTGUARD resilient adaptive preemption PASS', {
    failedVictimDoesNotBlockLaterVictims: true,
    failedVictimRemainsTracked: true,
    interactivePreserved: true,
    degradedResultSurfaced: true
  });
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
