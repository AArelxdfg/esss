'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { LlamaCppProcessBackend } = require('../src/llama-cpp-process-backend');

function createBackend() {
  return new LlamaCppProcessBackend({
    runtimeRoot: process.cwd(),
    fetch: async () => ({ ok: true, json: async () => ({ status: 'ok' }) }),
    stopGraceTimeoutMs: 5,
    stopForceTimeoutMs: 5,
  });
}

function createChild(pid, { exitOnForce = false } = {}) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  child.signals = [];
  child.kill = (signal) => {
    child.signals.push(signal);
    if (signal === 'SIGKILL' && exitOnForce) {
      setImmediate(() => {
        child.signalCode = 'SIGKILL';
        child.emit('exit', null, 'SIGKILL');
      });
    }
    return true;
  };
  return child;
}

test('llama.cpp stop escalates SIGTERM to SIGKILL and clears ownership only after exit', async () => {
  const backend = createBackend();
  const child = createChild(4401, { exitOnForce: true });
  backend.children.set(child.pid, child);

  await backend.stop({ pid: child.pid });

  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(backend.children.has(child.pid), false);
  assert.equal(await backend.isAlive({ pid: child.pid }), false);
});

test('llama.cpp stop timeout remains fail-closed when forced termination never exits', async () => {
  const backend = createBackend();
  const child = createChild(4402, { exitOnForce: false });
  backend.children.set(child.pid, child);

  await assert.rejects(
    backend.stop({ pid: child.pid }),
    (error) => error?.code === 'LLAMA_STOP_TIMEOUT' && error?.pid === child.pid,
  );

  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(backend.children.has(child.pid), true);
  assert.equal(await backend.isAlive({ pid: child.pid }), true);
});
