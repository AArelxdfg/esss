'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  flattenAssistantContent,
  extractAssistantText,
} = require('../src/llama-cpp-process-backend');

test('extractAssistantText prefers ordinary content', () => {
  assert.equal(extractAssistantText({ content: 'hello', reasoning_content: 'hidden' }), 'hello');
});

test('extractAssistantText falls back to reasoning_content when content is empty', () => {
  assert.equal(extractAssistantText({ content: '', reasoning_content: 'MONOLITH ONLINE' }), 'MONOLITH ONLINE');
});

test('flattenAssistantContent accepts OpenAI-style text arrays', () => {
  assert.equal(flattenAssistantContent([{ type: 'text', text: 'MONOLITH ' }, { type: 'text', text: 'ONLINE' }]), 'MONOLITH ONLINE');
});

test('extractAssistantText accepts array reasoning content', () => {
  assert.equal(extractAssistantText({ content: [], reasoning_content: [{ text: 'reasoning fallback' }] }), 'reasoning fallback');
});

test('extractAssistantText rejects structurally missing assistant output', () => {
  assert.equal(extractAssistantText({ content: null, reasoning_content: null }), null);
});
