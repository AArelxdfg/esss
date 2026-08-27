'use strict';
const assert = require('assert');
const { RuntimeLifecycle } = require('../src/runtime-lifecycle');

(async () => {
  const stopped = [];
  let pid = 100;
  const runtime = new RuntimeLifecycle({
    start: async ({ model }) => ({ pid: ++pid, model }),
    stop: async ({ pid, reason }) => { stopped.push({ pid, reason }); },
    health: async () => false,
    now: (() => { let t = 0; return () => ++t; })()
  });

  let failed = false;
  try { await runtime.ensureRunning('qwen3-next-80b-q4km'); }
  catch (e) { failed = /health check failed/.test(e.message); }
  assert.strictEqual(failed, true);
  assert.strictEqual(stopped.length, 1);
  assert.strictEqual(stopped[0].pid, 101);
  assert.strictEqual(stopped[0].reason, 'failed-start-cleanup');
  const snapshot = runtime.snapshot();
  assert.strictEqual(snapshot.state, 'failed');
  assert.strictEqual(snapshot.pid, null);
  assert.strictEqual(snapshot.model, null);
  assert.strictEqual(snapshot.generation, 0);
  assert.strictEqual(snapshot.desiredModel, 'qwen3-next-80b-q4km');

  const cleanupFail = new RuntimeLifecycle({
    start: async () => ({ pid: 202 }),
    stop: async () => { throw new Error('kill denied'); },
    health: async () => false
  });
  let cleanupThrownOriginal = false;
  try { await cleanupFail.ensureRunning('model-b'); }
  catch (e) { cleanupThrownOriginal = /health check failed/.test(e.message); }
  assert.strictEqual(cleanupThrownOriginal, true);
  assert.match(cleanupFail.snapshot().lastError, /cleanup failed: kill denied/);
  assert.strictEqual(cleanupFail.snapshot().state, 'failed');

  const healthyStopped = [];
  const healthy = new RuntimeLifecycle({
    start: async () => ({ pid: 303 }),
    stop: async ({pid}) => healthyStopped.push(pid),
    health: async () => true
  });
  const ready = await healthy.ensureRunning('model-c');
  assert.strictEqual(ready.state, 'ready');
  assert.strictEqual(ready.pid, 303);
  assert.strictEqual(ready.generation, 1);
  assert.deepStrictEqual(healthyStopped, []);

  console.log('runtime failed-start orphan guard PASS', {
    orphanCleanup: true,
    generationCommitAfterHealth: true,
    cleanupFailureSurfaced: true,
    desiredModelPreserved: true
  });
})().catch(err => { console.error(err); process.exit(1); });
