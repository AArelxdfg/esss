'use strict';

const assert = require('assert');
const { MonolithCapabilityBroker } = require('../src/monolith-capability-broker');
const { MonolithAgentToolRouter } = require('../src/agent-tool-router');

const calls = [];
const capabilityBroker = new MonolithCapabilityBroker({
  vision: {
    analyze: async args => {
      calls.push(['vision', args]);
      return { ok: true, kind: args.kind };
    }
  },
  diagnostics: {
    doctor: async args => {
      calls.push(['doctor', args]);
      return { ok: true, check: 'doctor' };
    },
    bench: async args => {
      calls.push(['bench', args]);
      return { ok: true, check: 'bench' };
    }
  }
});

const computerExecutor = {
  coverage() {
    return { available: [], portable: [], adapterBacked: [] };
  },
  async invoke() {
    throw new Error('historical specialized aliases must not fall through to computer executor');
  }
};

const router = new MonolithAgentToolRouter({ capabilityBroker, computerExecutor });

(async () => {
  assert.strictEqual(router.routeFor('vision_read_image'), 'specialized-compat');
  assert.strictEqual(router.routeFor('doctor_run'), 'specialized-compat');
  assert.strictEqual(router.routeFor('benchmark_run'), 'specialized-compat');

  const vision = await router.invoke('vision_read_image', { source: 'sample.png' });
  const doctor = await router.invoke('doctor_run', { scope: 'runtime' });
  const bench = await router.invoke('benchmark_run', { suite: 'smoke' });

  assert.deepStrictEqual(vision, { ok: true, kind: 'image' });
  assert.deepStrictEqual(doctor, { ok: true, check: 'doctor' });
  assert.deepStrictEqual(bench, { ok: true, check: 'bench' });
  assert.deepStrictEqual(calls.map(([name]) => name), ['vision', 'doctor', 'bench']);

  const coverage = router.coverage();
  const compat = new Map(coverage.historicalCompatibility.map(item => [item.tool, item]));
  for (const tool of ['vision_read_image', 'doctor_run', 'benchmark_run']) {
    assert.strictEqual(compat.get(tool).available, true, `${tool} must be attested through its reconstructed equivalent`);
  }
  assert.strictEqual(coverage.historicalCompatibilityAvailableCount, 3);

  console.log('Historical V5.4 capability routing PASS', {
    restoredHistoricalIdentities: 3,
    identities: ['vision_read_image', 'doctor_run', 'benchmark_run']
  });
})().catch(error => {
  console.error(error);
  process.exit(1);
});
