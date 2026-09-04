'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { installV54ProtocolRecovery, isDegenerate } = require('../src/llama-cpp-v54-protocol-recovery');

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

class FakeBackend {
  constructor(fetch) {
    this.fetch = fetch;
    this.endpoint = 'http://127.0.0.1:18191';
    this.inferenceTimeoutMs = 1000;
  }
  async chatCompletion() { const error = new Error('chat unavailable'); error.code = 'LLAMA_INFERENCE_HTTP_ERROR'; throw error; }
  async chatCompletionStream() { const error = new Error('stream unavailable'); error.code = 'LLAMA_STREAM_UNAVAILABLE'; throw error; }
}

installV54ProtocolRecovery(FakeBackend);

test('V5.4 compatibility retries recovery chat before raw completion', async () => {
  const calls = [];
  const backend = new FakeBackend(async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    if (url.endsWith('/v1/chat/completions')) return response(200, { choices: [{ message: { content: 'MONOLITH ONLINE', reasoning_content: 'PRIVATE REASONING' }, finish_reason: 'stop' }] });
    throw new Error(`unexpected ${url}`);
  });
  const result = await backend.chatCompletion({ messages: [{ role: 'user', content: 'status' }], maxTokens: 64, temperature: 0 });
  assert.equal(result.content, 'MONOLITH ONLINE');
  assert.equal(result.protocol, 'recovery');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.reasoning_effort, 'none');
  assert.equal(calls[0].body.chat_template_kwargs.enable_thinking, false);
});

test('reasoning_content is never surfaced when recovery chat lacks safe visible content', async () => {
  const calls = [];
  const backend = new FakeBackend(async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    if (url.endsWith('/v1/chat/completions')) {
      return response(200, { choices: [{ message: { content: '', reasoning_content: 'PRIVATE CHAIN MUST NOT LEAK' }, finish_reason: 'stop' }] });
    }
    if (url.endsWith('/completion')) return response(200, { content: 'SAFE RAW FALLBACK' });
    throw new Error(`unexpected ${url}`);
  });

  const result = await backend.chatCompletion({ messages: [{ role: 'user', content: 'status' }] });
  assert.equal(result.content, 'SAFE RAW FALLBACK');
  assert.equal(result.protocol, 'raw');
  assert.equal(calls.length, 2);
  assert.ok(!result.content.includes('PRIVATE CHAIN'));
});

test('V5.4 compatibility falls through to llama.cpp raw /completion', async () => {
  const calls = [];
  const backend = new FakeBackend(async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    if (url.endsWith('/v1/chat/completions')) return response(500, {});
    if (url.endsWith('/completion')) return response(200, { content: 'RAW RECOVERY OK' });
    throw new Error(`unexpected ${url}`);
  });
  const result = await backend.chatCompletionStream({ messages: [{ role: 'system', content: 'system' }, { role: 'user', content: 'hello' }] });
  assert.equal(result.content, 'RAW RECOVERY OK');
  assert.equal(result.protocol, 'raw');
  assert.equal(calls.length, 2);
  assert.ok(calls[1].body.prompt.includes('Sistem: system'));
  assert.ok(calls[1].body.prompt.includes('Kullanıcı: hello'));
  assert.equal(calls[1].body.stream, false);
  assert.deepEqual(calls[1].body.stop, ['\nKullanıcı:', '\nSistem:', '\nAraç:', '\nLLera:']);
});

test('caller abort never triggers a recovery or raw retry', async () => {
  class AbortBackend {
    constructor(fetch) { this.fetch = fetch; this.endpoint = 'http://127.0.0.1:18191'; this.inferenceTimeoutMs = 1000; }
    async chatCompletion() { const error = new Error('aborted'); error.code = 'LLAMA_INFERENCE_ABORTED'; throw error; }
    async chatCompletionStream() { const error = new Error('aborted'); error.code = 'LLAMA_INFERENCE_ABORTED'; throw error; }
  }
  installV54ProtocolRecovery(AbortBackend);
  let fetchCalls = 0;
  const backend = new AbortBackend(async () => { fetchCalls += 1; return response(200, {}); });
  await assert.rejects(() => backend.chatCompletion({ messages: [{ role: 'user', content: 'x' }] }), error => error.code === 'LLAMA_INFERENCE_ABORTED');
  assert.equal(fetchCalls, 0);
});

test('unterminated reasoning blocks are never accepted as user-visible recovery output', async () => {
  assert.equal(isDegenerate('<think>private chain that never closes'), true);
  assert.equal(isDegenerate('<analysis>private analysis that never closes'), true);

  const calls = [];
  const backend = new FakeBackend(async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    if (url.endsWith('/v1/chat/completions')) {
      return response(200, { choices: [{ message: { content: '<think>unfinished hidden reasoning' }, finish_reason: 'stop' }] });
    }
    if (url.endsWith('/completion')) {
      return response(200, { content: 'VISIBLE RECOVERY ONLY' });
    }
    throw new Error(`unexpected ${url}`);
  });

  const result = await backend.chatCompletion({ messages: [{ role: 'user', content: 'status' }] });
  assert.equal(result.content, 'VISIBLE RECOVERY ONLY');
  assert.equal(result.protocol, 'raw');
  assert.equal(calls.length, 2);
});
