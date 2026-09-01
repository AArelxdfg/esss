'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { LlamaCppProcessBackend, assertContained } = require('../src/llama-cpp-process-backend');

function fakeFs(existing) {
  const set = new Set(existing.map(p => path.resolve(p)));
  return { existsSync: p => set.has(path.resolve(p)) };
}

function fakeChild(pid = 4242) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.killed = false;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {
    child.killed = true;
    queueMicrotask(() => { child.exitCode = 0; child.emit('exit', 0, null); });
    return true;
  };
  return child;
}

test('runtime paths are confined to LLera engine/models roots', () => {
  const root = path.resolve('tmp-llera-runtime');
  const models = path.join(root, 'models');
  assert.equal(assertContained(models, path.join(models, 'model.gguf'), 'model'), path.join(models, 'model.gguf'));
  assert.throws(() => assertContained(models, path.join(root, '..', 'outside.gguf'), 'model'), /escapes LLera runtime root/);
});

test('backend starts loopback-only llama-server with a catalog-bound model', async () => {
  const root = path.resolve('tmp-llera-runtime');
  const engine = path.join(root, 'engine', process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
  const model = path.join(root, 'models', 'instant.gguf');
  let spawnCall = null;
  const child = fakeChild();
  const backend = new LlamaCppProcessBackend({
    runtimeRoot: root,
    enginePath: engine,
    modelCatalog: { instant: 'instant.gguf' },
    fsImpl: fakeFs([engine, model]),
    spawn: (exe, args, options) => { spawnCall = { exe, args, options }; return child; },
    fetch: async () => ({ ok: true, json: async () => ({ status: 'ok' }) }),
  });

  const started = await backend.start({ model: 'instant', generation: 3 });
  assert.equal(started.pid, child.pid);
  assert.equal(started.endpoint, 'http://127.0.0.1:18191');
  assert.equal(spawnCall.exe, engine);
  assert.deepEqual(spawnCall.args.slice(0, 6), ['--model', model, '--host', '127.0.0.1', '--port', '18191']);
  assert.equal(spawnCall.options.detached, false);
  assert.equal(await backend.health(), true);
  assert.equal(await backend.isAlive({ pid: child.pid }), true);
  await backend.stop({ pid: child.pid });
  assert.equal(child.exitCode, 0);
});

test('backend sends bounded OpenAI-compatible chat completions to loopback llama.cpp', async () => {
  const root = path.resolve('tmp-llera-runtime');
  let request = null;
  const backend = new LlamaCppProcessBackend({
    runtimeRoot: root,
    fetch: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: 'instant',
          choices: [{ message: { role: 'assistant', content: 'MONOLITH ONLINE' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
        }),
      };
    },
  });

  const result = await backend.chatCompletion({
    messages: [{ role: 'user', content: 'Reply with MONOLITH ONLINE' }],
    maxTokens: 999999,
    temperature: 9,
  });

  assert.equal(request.url, 'http://127.0.0.1:18191/v1/chat/completions');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers['content-type'], 'application/json');
  const payload = JSON.parse(request.options.body);
  assert.deepEqual(payload.messages, [{ role: 'user', content: 'Reply with MONOLITH ONLINE' }]);
  assert.equal(payload.max_tokens, 32768);
  assert.equal(payload.temperature, 2);
  assert.equal(payload.stream, false);
  assert.equal(result.content, 'MONOLITH ONLINE');
  assert.equal(result.finishReason, 'stop');
  assert.equal(result.usage.total_tokens, 6);
});

test('chat completion rejects invalid roles and non-loopback endpoints before network I/O', async () => {
  const root = path.resolve('tmp-llera-runtime');
  let calls = 0;
  const fetch = async () => { calls += 1; return { ok: true, json: async () => ({}) }; };
  const backend = new LlamaCppProcessBackend({ runtimeRoot: root, fetch });
  await assert.rejects(
    () => backend.chatCompletion({ messages: [{ role: 'root', content: 'nope' }] }),
    err => err.code === 'LLAMA_MESSAGE_ROLE_INVALID'
  );
  const exposed = new LlamaCppProcessBackend({ runtimeRoot: root, endpoint: 'http://0.0.0.0:18191', fetch });
  await assert.rejects(
    () => exposed.chatCompletion({ messages: [{ role: 'user', content: 'hello' }] }),
    err => err.code === 'LLAMA_NON_LOOPBACK_BIND'
  );
  assert.equal(calls, 0);
});

test('chat completion exposes HTTP failures and aborts fail closed', async () => {
  const root = path.resolve('tmp-llera-runtime');
  const failed = new LlamaCppProcessBackend({
    runtimeRoot: root,
    fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  });
  await assert.rejects(
    () => failed.chatCompletion({ messages: [{ role: 'user', content: 'hello' }] }),
    err => err.code === 'LLAMA_INFERENCE_HTTP_ERROR' && err.status === 503
  );

  const controller = new AbortController();
  controller.abort();
  const aborted = new LlamaCppProcessBackend({
    runtimeRoot: root,
    fetch: async (_url, options) => {
      if (options.signal.aborted) throw new Error('aborted');
      return { ok: true, json: async () => ({}) };
    },
  });
  await assert.rejects(
    () => aborted.chatCompletion({ messages: [{ role: 'user', content: 'hello' }], signal: controller.signal }),
    err => err.code === 'LLAMA_INFERENCE_ABORTED'
  );
});

test('unknown models and non-loopback endpoints fail closed before spawn', async () => {
  const root = path.resolve('tmp-llera-runtime');
  const engine = path.join(root, 'engine', process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
  const model = path.join(root, 'models', 'instant.gguf');
  let spawns = 0;
  const common = {
    runtimeRoot: root,
    enginePath: engine,
    fsImpl: fakeFs([engine, model]),
    spawn: () => { spawns += 1; return fakeChild(); },
    fetch: async () => ({ ok: true, json: async () => ({ status: 'ok' }) }),
  };
  const known = new LlamaCppProcessBackend({ ...common, modelCatalog: { instant: 'instant.gguf' } });
  await assert.rejects(() => known.start({ model: 'missing', generation: 1 }), err => err.code === 'LLAMA_MODEL_UNKNOWN');

  const exposed = new LlamaCppProcessBackend({ ...common, endpoint: 'http://0.0.0.0:18191', modelCatalog: { instant: 'instant.gguf' } });
  await assert.rejects(() => exposed.start({ model: 'instant', generation: 1 }), err => err.code === 'LLAMA_NON_LOOPBACK_BIND');
  assert.equal(spawns, 0);
});
