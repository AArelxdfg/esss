'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_WORK_RESULT_BYTES,
  normalizeWorkResult,
} = require('../app/services/work-mode-service.cjs');

test('Work Mode completion results are normalized into bounded durable JSON', () => {
  const input = { summary: 'verified', nested: { count: 2 }, values: [1, 2, 3] };
  const result = normalizeWorkResult(input);

  assert.deepEqual(result, input);
  assert.notStrictEqual(result, input, 'durable result must be detached from renderer-owned input');
  assert.notStrictEqual(result.nested, input.nested, 'nested state must also be detached');
});

test('Work Mode rejects cyclic completion results before mission persistence', () => {
  const cyclic = { summary: 'cycle' };
  cyclic.self = cyclic;

  assert.throws(
    () => normalizeWorkResult(cyclic),
    error => error && error.code === 'WORK_MODE_RESULT_INVALID'
  );
});

test('Work Mode rejects oversized completion results using UTF-8 byte length', () => {
  const oversized = { summary: '€'.repeat(MAX_WORK_RESULT_BYTES) };

  assert.throws(
    () => normalizeWorkResult(oversized),
    error => error &&
      error.code === 'WORK_MODE_RESULT_TOO_LARGE' &&
      error.byteLength > error.maxBytes &&
      error.maxBytes === MAX_WORK_RESULT_BYTES
  );
});

test('Work Mode rejects non-object completion result roots', () => {
  for (const invalid of ['done', 1, true, [], () => {}]) {
    assert.throws(
      () => normalizeWorkResult(invalid),
      error => error && error.code === 'WORK_MODE_RESULT_INVALID'
    );
  }
});

test('Work Mode rejects nested values that JSON would silently erase or coerce', () => {
  const cases = [
    { value: { nested: { missing: undefined } }, path: 'result.nested.missing' },
    { value: { nested: { callback() {} } }, path: 'result.nested.callback' },
    { value: { metric: Number.NaN }, path: 'result.metric' },
    { value: { metric: Number.POSITIVE_INFINITY }, path: 'result.metric' },
    { value: { metric: -0 }, path: 'result.metric' },
  ];

  for (const entry of cases) {
    assert.throws(
      () => normalizeWorkResult(entry.value),
      error => error && error.code === 'WORK_MODE_RESULT_INVALID' && error.path === entry.path
    );
  }
});

test('Work Mode rejects sparse arrays and non-index array properties', () => {
  const sparse = [];
  sparse[1] = 'persisted';
  assert.throws(
    () => normalizeWorkResult({ values: sparse }),
    error => error && error.code === 'WORK_MODE_RESULT_INVALID' && error.path === 'result.values[0]'
  );

  const decorated = ['persisted'];
  decorated.meta = 'would be dropped';
  assert.throws(
    () => normalizeWorkResult({ values: decorated }),
    error => error && error.code === 'WORK_MODE_RESULT_INVALID' && error.path === 'result.values'
  );
});

test('Work Mode rejects non-plain objects instead of persisting a changed representation', () => {
  class CompletionReceipt {
    constructor() { this.status = 'verified'; }
  }

  for (const value of [new Date('2026-09-03T00:00:00Z'), new Map([['status', 'verified']]), new CompletionReceipt()]) {
    assert.throws(
      () => normalizeWorkResult({ value }),
      error => error && error.code === 'WORK_MODE_RESULT_INVALID' && error.path === 'result.value'
    );
  }
});

test('Work Mode rejects accessors without invoking renderer-owned getters', () => {
  let getterCalls = 0;
  const payload = {};
  Object.defineProperty(payload, 'computed', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('getter must never execute');
    },
  });

  assert.throws(
    () => normalizeWorkResult(payload),
    error => error && error.code === 'WORK_MODE_RESULT_INVALID' && error.path === 'result.computed'
  );
  assert.equal(getterCalls, 0);
});

test('Work Mode rejects prototype-sensitive keys and still accepts null-prototype JSON records', () => {
  const dangerous = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(
    () => normalizeWorkResult(dangerous),
    error => error && error.code === 'WORK_MODE_RESULT_INVALID' && error.path === 'result.__proto__'
  );
  assert.equal({}.polluted, undefined);

  const safe = Object.create(null);
  safe.summary = 'verified';
  safe.count = 2;
  assert.deepEqual(normalizeWorkResult(safe), { summary: 'verified', count: 2 });
});
