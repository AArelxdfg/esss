'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RuntimeLifecycle } = require('../src/runtime-lifecycle');

test('runtime health admission fails closed on non-boolean backend results', async () => {
  for (const malformed of [{}, 'healthy', 1, [], null, undefined]) {
    let stopCalls = 0;
    const runtime = new RuntimeLifecycle({
      start: async () => ({ pid: 7001 }),
      health: async () => malformed,
      stop: async () => { stopCalls += 1; },
      isAlive: async () => false,
    });

    await assert.rejects(
      () => runtime.ensureRunning('tinyllama-validation'),
      error => error && error.code === 'RUNTIME_HEALTH_RESULT_INVALID'
    );

    const snapshot = runtime.snapshot();
    assert.equal(snapshot.state, 'failed');
    assert.equal(snapshot.pid, null);
    assert.equal(snapshot.model, null);
    assert.equal(snapshot.generation, 0);
    assert.equal(stopCalls, 0, 'already-dead cleanup target should not be stopped twice');
  }
});

test('runtime pid liveness probe rejects non-boolean results without mutating tracked identity', async () => {
  for (const malformed of ['false', 'true', 0, 1, {}, []]) {
    let probeMode = 'startup';
    let stopCalls = 0;
    const runtime = new RuntimeLifecycle({
      start: async () => ({ pid: 7101 }),
      health: async () => true,
      stop: async () => { stopCalls += 1; },
      isAlive: async () => probeMode === 'startup' ? true : malformed,
    });

    const ready = await runtime.ensureRunning('tinyllama-validation');
    assert.equal(ready.state, 'ready');
    assert.equal(ready.pid, 7101);

    probeMode = 'malformed';
    await assert.rejects(
      () => runtime.stop('malformed-liveness-probe'),
      error => error && error.code === 'RUNTIME_PID_PROBE_INVALID' && error.pid === 7101
    );

    const failedClosed = runtime.snapshot();
    assert.equal(failedClosed.state, 'failed');
    assert.equal(failedClosed.pid, 7101);
    assert.equal(failedClosed.model, 'tinyllama-validation');
    assert.equal(stopCalls, 0, 'stop backend must not run when process identity cannot be proven');
  }
});
