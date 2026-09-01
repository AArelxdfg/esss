'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  flattenAssistantContent,
  extractAssistantText,
} = require('../src/llama-cpp-process-backend');

test('flattenAssistantContent tolerates mixed OpenAI-style text shapes without inventing output', () => {
  assert.equal(
    flattenAssistantContent([
      'MONOLITH ',
      { type: 'text', text: 'ONLINE' },
      null,
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } },
      { content: '!' },
    ]),
    'MONOLITH ONLINE!'
  );
});

test('extractAssistantText does not use reasoning_content when ordinary content is present', () => {
  assert.equal(
    extractAssistantText({
      content: [{ type: 'text', text: 'VISIBLE' }],
      reasoning_content: [{ type: 'text', text: 'HIDDEN' }],
    }),
    'VISIBLE'
  );
});

test('extractAssistantText falls back to reasoning arrays only when ordinary content has no text', () => {
  assert.equal(
    extractAssistantText({
      content: [{ type: 'image_url', image_url: { url: 'ignored' } }],
      reasoning_content: ['MONOLITH ', { text: 'ONLINE' }],
    }),
    'MONOLITH ONLINE'
  );
});

test('response compatibility helpers fail closed for unsupported scalar/object payloads', () => {
  assert.equal(flattenAssistantContent(42), null);
  assert.equal(flattenAssistantContent({ text: 'not-an-array' }), null);
  assert.equal(extractAssistantText({ content: 42, reasoning_content: { text: 'not-an-array' } }), null);
  assert.equal(extractAssistantText(null), null);
});
