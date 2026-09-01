'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { MonolithService } = require('../app/services/monolith-service.cjs');

test('desktop product service persists conversations and fails closed without a model', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'llera-product-service-'));
  const service = new MonolithService({ userData });
  await service.init();
  const created = await service.createConversation();
  assert.equal(created.conversations.length, 1);

  const result = await service.send({ content: 'Do not fabricate an answer.' });
  assert.equal(result.blocked, true);
  assert.equal(result.code, 'MODEL_NOT_CONFIGURED');
  assert.equal(result.snapshot.activeConversation.messages.length, 2);
  assert.equal(result.snapshot.activeConversation.messages[1].status, 'blocked');

  const restarted = new MonolithService({ userData });
  await restarted.init();
  assert.equal(restarted.snapshot().activeConversation.messages[0].content, 'Do not fabricate an answer.');
});

test('desktop product service binds attachment metadata to local bytes', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'llera-product-attachment-'));
  const service = new MonolithService({ userData });
  await service.init();
  const attachment = await service.attach({ name: 'notes.txt', type: 'text/plain', bytes: Buffer.from('local evidence') });
  assert.match(attachment.sha256, /^[a-f0-9]{64}$/);
  assert.equal(attachment.bytes, 14);
  await assert.rejects(() => service.attach({ name: 'bad.exe', type: 'application/octet-stream', bytes: Buffer.from('x') }));
});

test('desktop inference is generation-bound and stale completion is discarded', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'llera-product-generation-'));
  const service = new MonolithService({ userData });
  await service.init();
  service.catalog = { local: { path: 'unused.gguf' } };

  let registered = null;
  service.runtime = {
    snapshot: () => ({ state: 'ready', model: 'local', generation: 7 }),
    start: async () => { throw new Error('unexpected start'); },
    registerInference: (id, options) => {
      registered = { id, ...options, generation: 7 };
      return { id, generation: 7, priority: options.priority };
    },
    completeInference: () => false,
  };
  service.backend = {
    chatCompletion: async ({ signal }) => {
      assert.equal(signal instanceof AbortSignal, true);
      return { content: 'stale answer', model: 'local', usage: null, finishReason: 'stop' };
    },
  };

  const result = await service.send({ content: 'generation safety' });
  assert.equal(registered.priority, 'normal');
  assert.equal(typeof registered.abort, 'function');
  assert.equal(result.blocked, true);
  assert.equal(result.code, 'STALE_INFERENCE_GENERATION');
  assert.equal(result.snapshot.activeConversation.messages.some(message => message.content === 'stale answer'), false);
  assert.match(result.snapshot.activeConversation.messages.at(-1).content, /runtime generation changed/i);
});

test('desktop inference registers abortable lifecycle work and records a valid completion', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'llera-product-completion-'));
  const service = new MonolithService({ userData });
  await service.init();
  service.catalog = { local: { path: 'unused.gguf' } };

  const completions = [];
  service.runtime = {
    snapshot: () => ({ state: 'ready', model: 'local', generation: 11 }),
    start: async () => { throw new Error('unexpected start'); },
    registerInference: (id, options) => ({ id, generation: 11, priority: options.priority }),
    completeInference: (id, generation) => { completions.push({ id, generation }); return true; },
  };
  service.backend = {
    chatCompletion: async ({ messages, signal }) => {
      assert.equal(signal instanceof AbortSignal, true);
      assert.equal(messages.at(-1).content, 'real local request');
      return { content: 'real local response', model: 'local', usage: { total_tokens: 4 }, finishReason: 'stop' };
    },
  };

  const result = await service.send({ content: 'real local request' });
  assert.equal(result.blocked, false);
  assert.equal(completions.length, 1);
  assert.equal(completions[0].generation, 11);
  assert.equal(result.snapshot.activeConversation.messages.at(-1).content, 'real local response');
  assert.equal(result.snapshot.activeConversation.messages.at(-1).model, 'local');
});
