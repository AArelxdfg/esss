'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LlamaCppProcessBackend } = require('../src/llama-cpp-process-backend');

test('health waits through transient llama.cpp startup responses until ready', async () => {
  let calls = 0;
  const responses = [
    { ok: false, status: 503, json: async () => ({ status: 'loading model' }) },
    { ok: true, status: 200, json: async () => ({ status: 'loading' }) },
    { ok: true, status: 200, json: async () => ({ status: 'ready' }) },
  ];

  const backend = new LlamaCppProcessBackend({
    runtimeRoot: 'tmp-llera-runtime',
    healthTimeoutMs: 500,
    healthPollIntervalMs: 1,
    fetch: async (url) => {
      assert.equal(url, 'http://127.0.0.1:18191/health');
      const response = responses[Math.min(calls, responses.length - 1)];
      calls += 1;
      return response;
    },
  });

  assert.equal(await backend.health(), true);
  assert.equal(calls, 3);
});

test('health remains fail-closed when llama.cpp never becomes ready', async () => {
  let calls = 0;
  const backend = new LlamaCppProcessBackend({
    runtimeRoot: 'tmp-llera-runtime',
    healthTimeoutMs: 15,
    healthPollIntervalMs: 2,
    fetch: async () => {
      calls += 1;
      return { ok: false, status: 503, json: async () => ({ status: 'loading model' }) };
    },
  });

  assert.equal(await backend.health(), false);
  assert.ok(calls >= 2);
});
