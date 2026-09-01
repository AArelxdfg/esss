'use strict';
const assert = require('assert');
const { RuntimeLifecycle } = require('../src/runtime-lifecycle');
const { RuntimeInferenceCoordinator } = require('../src/runtime-inference-coordinator');

class Governor {
  constructor() { this.active = new Map(); }
  admit({ id, className }) {
    const admission = { allow:true, id, className, maxTokens:1024, reasoning:'normal', pressure:'normal', startedAt:Date.now() };
    this.active.set(id, admission);
    return admission;
  }
  complete(id) { return this.active.delete(id); }
}

(async () => {
  let nextPid = 700;
  const runtime = new RuntimeLifecycle({
    start: async () => ({ pid:++nextPid }),
    stop: async () => {},
    health: async () => true
  });

  await runtime.ensureRunning('model-a');
  const first = runtime.registerInference('reused-id', { abort:async () => {} });
  assert.strictEqual(runtime.completeInference('reused-id'), false, 'generation-less completion must fail closed');
  assert.strictEqual(runtime.completeInference('reused-id', first.generation - 1), false, 'wrong-generation completion must fail closed');
  assert.strictEqual(runtime.completeInference('reused-id', first.generation), true);

  await runtime.recover('force-new-generation');
  const governor = new Governor();
  const coordinator = new RuntimeInferenceCoordinator({ runtime, governor });
  const current = coordinator.begin({ id:'reused-id', className:'interactive', abort:async () => {} });
  assert.ok(current.generation > first.generation);
  assert.strictEqual(coordinator.complete('reused-id'), false, 'coordinator must reject generation-less completion');
  assert.strictEqual(coordinator.complete('reused-id', first.generation), false, 'stale completion must not remove current work');
  assert.strictEqual(runtime.activeInference.has('reused-id'), true);
  assert.strictEqual(governor.active.has('reused-id'), true);
  assert.strictEqual(coordinator.complete('reused-id', current.generation), true);
  assert.strictEqual(runtime.activeInference.has('reused-id'), false);
  assert.strictEqual(governor.active.has('reused-id'), false);

  console.log('runtime generation-bound completion PASS', {
    generationlessFailClosed:true,
    staleCompletionRejected:true,
    currentCompletionAccepted:true,
    firstGeneration:first.generation,
    currentGeneration:current.generation
  });
})().catch(error => { console.error(error); process.exit(1); });
