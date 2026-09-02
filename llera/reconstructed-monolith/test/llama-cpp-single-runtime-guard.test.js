'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { LlamaCppProcessBackend } = require('../src/llama-cpp-process-backend');

function fakeFs(existing) {
  const set = new Set(existing.map(p => path.resolve(p)));
  return { existsSync: p => set.has(path.resolve(p)) };
}

function childProcess(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  child.killed = false;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {
    child.killed = true;
    return true;
  };
  child.finishExit = () => {
    child.signalCode = 'SIGTERM';
    child.emit('exit', null, 'SIGTERM');
  };
  return child;
}

test('backend refuses a second llama-server until the tracked runtime has actually exited', async () => {
  const root = path.resolve('tmp-llera-single-runtime');
  const engine = path.join(root, 'engine', process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
  const model = path.join(root, 'models', 'instant.gguf');
  const children = [childProcess(5001), childProcess(5002)];
  let spawnCount = 0;

  const backend = new LlamaCppProcessBackend({
    runtimeRoot: root,
    enginePath: engine,
    modelCatalog: { instant: 'instant.gguf' },
    fsImpl: fakeFs([engine, model]),
    spawn: () => children[spawnCount++],
    fetch: async () => ({ ok: true, json: async () => ({ status: 'ok' }) }),
  });

  const first = await backend.start({ model: 'instant', generation: 1 });
  assert.equal(first.pid, 5001);
  assert.equal(spawnCount, 1);

  await assert.rejects(
    () => backend.start({ model: 'instant', generation: 2 }),
    err => err.code === 'LLAMA_SINGLE_RUNTIME_VIOLATION' && err.pid === 5001
  );
  assert.equal(spawnCount, 1);

  // A successful kill() call only means SIGTERM was sent. Until the child emits
  // exit, it must still be treated as live and must continue blocking replacement.
  children[0].killed = true;
  assert.equal(await backend.isAlive({ pid: 5001 }), true);
  await assert.rejects(
    () => backend.start({ model: 'instant', generation: 2 }),
    err => err.code === 'LLAMA_SINGLE_RUNTIME_VIOLATION'
  );
  assert.equal(spawnCount, 1);

  children[0].finishExit();
  assert.equal(await backend.isAlive({ pid: 5001 }), false);

  const second = await backend.start({ model: 'instant', generation: 2 });
  assert.equal(second.pid, 5002);
  assert.equal(spawnCount, 2);
});
