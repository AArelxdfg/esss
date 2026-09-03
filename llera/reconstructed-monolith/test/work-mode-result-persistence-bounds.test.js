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
