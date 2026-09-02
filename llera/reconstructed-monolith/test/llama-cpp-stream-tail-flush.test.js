'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Readable } = require('node:stream');
const { LlamaCppProcessBackend } = require('../src/llama-cpp-process-backend');

test('streaming completion flushes an unterminated final SSE event and decoder tail', async () => {
  const root = path.resolve('tmp-llera-runtime');
  const deltas = [];
  const first = 'data: {"model":"instant","choices":[{"delta":{"content":"MONOLITH "},"finish_reason":null}]}\n\n';
  const final = 'data: {"model":"instant-v2","choices":[{"delta":{"content":"OMEGA ✓"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}';
  const finalBytes = Buffer.from(final, 'utf8');
  const splitAt = finalBytes.length - 1;

  const backend = new LlamaCppProcessBackend({
    runtimeRoot: root,
    fetch: async () => ({
      ok: true,
      status: 200,
      body: Readable.from([
        Buffer.from(first, 'utf8'),
        finalBytes.subarray(0, splitAt),
        finalBytes.subarray(splitAt),
      ]),
    }),
  });

  const result = await backend.chatCompletionStream({
    messages: [{ role: 'user', content: 'Reply exactly' }],
    onDelta: delta => deltas.push(delta),
  });

  assert.deepEqual(deltas, ['MONOLITH ', 'OMEGA ✓']);
  assert.equal(result.content, 'MONOLITH OMEGA ✓');
  assert.equal(result.finishReason, 'stop');
  assert.equal(result.model, 'instant-v2');
  assert.deepEqual(result.usage, { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });
});
