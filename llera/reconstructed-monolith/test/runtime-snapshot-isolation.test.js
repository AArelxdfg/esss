'use strict';

const assert = require('assert');
const { RuntimeLifecycle } = require('../src/runtime-lifecycle');

async function run() {
  let pid = 9000;
  let rejectModel = null;
  const runtime = new RuntimeLifecycle({
    start: async () => ({ pid: ++pid }),
    stop: async () => {},
    health: async ({ model }) => model !== rejectModel,
    now: (() => { let n = 5000; return () => ++n; })()
  });

  await runtime.ensureRunning('model-a');
  rejectModel = 'model-b';
  await assert.rejects(
    runtime.ensureRunning('model-b'),
    /runtime health check failed/
  );

  const snapshot = runtime.snapshot();
  assert(snapshot.lastSwitchFailure);
  assert.equal(snapshot.lastSwitchFailure.to, 'model-b');
  assert.equal(snapshot.lastSwitchFailure.restored, true);

  snapshot.lastSwitchFailure.to = 'tampered';
  snapshot.lastSwitchFailure.restored = false;

  const fresh = runtime.snapshot();
  assert.equal(fresh.lastSwitchFailure.to, 'model-b');
  assert.equal(fresh.lastSwitchFailure.restored, true);

  console.log(JSON.stringify({
    pass: true,
    runtimeSnapshotIsolation: true,
    switchFailureStateProtected: true
  }));
}

run().catch(err => {
  console.error(err.stack || err);
  process.exit(1);
});
