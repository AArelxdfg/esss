'use strict';

const assert = require('assert');
const { RuntimeLifecycle } = require('../src/runtime-lifecycle');

async function run() {
  let nextPid = 2000;
  const starts = [];
  const stops = [];
  const healthChecks = [];
  let rejectModel = null;

  const runtime = new RuntimeLifecycle({
    start: async ({ model, generation }) => {
      starts.push({ model, generation });
      return { pid: ++nextPid };
    },
    stop: async ({ pid, model, reason }) => {
      stops.push({ pid, model, reason: reason || null });
    },
    health: async ({ pid, model }) => {
      healthChecks.push({ pid, model });
      return model !== rejectModel;
    },
    now: (() => { let n = 1000; return () => ++n; })()
  });

  let snapshot = await runtime.ensureRunning('qwen3-next-80b-q4km');
  assert.equal(snapshot.state, 'ready');
  assert.equal(snapshot.model, 'qwen3-next-80b-q4km');
  const initialGeneration = snapshot.generation;

  rejectModel = 'gpt-oss-120b-mxfp4';
  await assert.rejects(
    runtime.ensureRunning('gpt-oss-120b-mxfp4'),
    /runtime health check failed/
  );

  snapshot = runtime.snapshot();
  assert.equal(snapshot.state, 'ready');
  assert.equal(snapshot.model, 'qwen3-next-80b-q4km');
  assert.equal(snapshot.desiredModel, 'gpt-oss-120b-mxfp4');
  assert.equal(snapshot.generation, initialGeneration + 1);
  assert.equal(snapshot.switchRollbackCount, 1);
  assert.equal(snapshot.lastSwitchFailure.from, 'qwen3-next-80b-q4km');
  assert.equal(snapshot.lastSwitchFailure.to, 'gpt-oss-120b-mxfp4');
  assert.equal(snapshot.lastSwitchFailure.restored, true);

  assert.deepEqual(
    starts.map(x => x.model),
    [
      'qwen3-next-80b-q4km',
      'gpt-oss-120b-mxfp4',
      'qwen3-next-80b-q4km'
    ]
  );

  assert.deepEqual(
    stops.map(x => x.model),
    [
      'qwen3-next-80b-q4km',
      'gpt-oss-120b-mxfp4'
    ]
  );

  const transitions = runtime.transitionLog.map(x => `${x.from}->${x.to}:${x.reason}`);
  assert(transitions.some(x => x === 'ready->stopping:model-switch:qwen3-next-80b-q4km->gpt-oss-120b-mxfp4'));
  assert(transitions.some(x => x === 'starting->failed:start-failed-cleaned'));
  assert(transitions.some(x => x.includes('failed->recovering:model-switch-rollback:gpt-oss-120b-mxfp4->qwen3-next-80b-q4km')));
  assert(transitions.some(x => x.includes('starting->ready:model-switch-rollback:gpt-oss-120b-mxfp4->qwen3-next-80b-q4km')));

  console.log(JSON.stringify({
    pass: true,
    singleRuntime: true,
    failedSwitchRollback: true,
    preferredTargetPreserved: true,
    rollbackGenerationAdvanced: true
  }));
}

run().catch(err => {
  console.error(err.stack || err);
  process.exit(1);
});
