'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeWorkResult, MAX_WORK_RESULT_DEPTH } = require('../app/services/work-mode-service.cjs');

function nestedObject(depth) {
  const root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  cursor.done = true;
  return root;
}

test('Work Mode accepts checkpoint payloads at the supported nesting boundary', () => {
  const payload = nestedObject(MAX_WORK_RESULT_DEPTH);
  assert.deepEqual(normalizeWorkResult(payload), payload);
});

test('Work Mode rejects excessive checkpoint nesting with a deterministic product error', () => {
  const payload = nestedObject(MAX_WORK_RESULT_DEPTH + 1);
  assert.throws(
    () => normalizeWorkResult(payload),
    error => error && error.code === 'WORK_MODE_RESULT_INVALID' && /maximum nesting depth/.test(error.message)
  );
});

test('Work Mode rejects deeply nested arrays before recursive stack exhaustion', () => {
  const payload = { value: [] };
  let cursor = payload.value;
  for (let i = 0; i < MAX_WORK_RESULT_DEPTH + 4; i += 1) {
    const next = [];
    cursor.push(next);
    cursor = next;
  }
  assert.throws(
    () => normalizeWorkResult(payload),
    error => error && error.code === 'WORK_MODE_RESULT_INVALID' && /maximum nesting depth/.test(error.message)
  );
});
