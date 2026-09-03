'use strict';

const assert = require('assert');
const { RuntimeLifecycle } = require('../src/runtime-lifecycle');

(async () => {
  const invalidPids = [
    undefined,
    null,
    0,
    -1,
    1.5,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    '123',
    {},
    []
  ];

  for (const pid of invalidPids) {
    let healthCalls = 0;
    let stopCalls = 0;
    let aliveCalls = 0;
    const runtime = new RuntimeLifecycle({
      start: async () => ({ pid }),
      stop: async () => { stopCalls += 1; },
      health: async () => { healthCalls += 1; return true; },
      isAlive: async () => { aliveCalls += 1; return true; }
    });

    await assert.rejects(
      () => runtime.ensureRunning('model-a', 'invalid-start-pid'),
      error => error && error.code === 'RUNTIME_START_PID_INVALID'
    );

    const snapshot = runtime.snapshot();
    assert.strictEqual(snapshot.state, 'failed');
    assert.strictEqual(snapshot.pid, null, `invalid pid must not be tracked: ${String(pid)}`);
    assert.strictEqual(snapshot.model, null);
    assert.strictEqual(snapshot.generation, 0);
    assert.strictEqual(healthCalls, 0, 'untrusted pid must not reach health backend');
    assert.strictEqual(stopCalls, 0, 'untrusted pid must not reach stop backend');
    assert.strictEqual(aliveCalls, 0, 'untrusted pid must not reach process probe');
  }

  let healthPid = null;
  const valid = new RuntimeLifecycle({
    start: async () => ({ pid: 321 }),
    stop: async () => undefined,
    health: async ({ pid }) => { healthPid = pid; return true; },
    isAlive: async () => true
  });
  const ready = await valid.ensureRunning('model-valid', 'valid-start-pid');
  assert.strictEqual(ready.state, 'ready');
  assert.strictEqual(ready.pid, 321);
  assert.strictEqual(ready.generation, 1);
  assert.strictEqual(healthPid, 321);

  console.log('MONOLITH runtime start PID signal contract PASS', {
    invalidPidCases: invalidPids.length,
    invalidPidFailsClosed: true,
    malformedPidBackendIoBlocked: true,
    validPositiveSafeIntegerPreserved: true
  });
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
