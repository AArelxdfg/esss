'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_WORK_RESULT_NODES,
  normalizeWorkResult
} = require('../app/services/work-mode-service.cjs');

test('Work Mode rejects very wide checkpoint graphs before persistence', () => {
  const payload = Object.create(null);
  for (let index = 0; index < MAX_WORK_RESULT_NODES; index += 1) {
    payload[`k${index}`] = index;
  }

  assert.throws(
    () => normalizeWorkResult(payload),
    error => error &&
      error.code === 'WORK_MODE_RESULT_INVALID' &&
      error.path === `result.k${MAX_WORK_RESULT_NODES - 1}` &&
      /maximum node count/.test(error.message)
  );
});

test('Work Mode still accepts bounded durable checkpoint graphs', () => {
  const payload = { items: [] };
  for (let index = 0; index < 512; index += 1) {
    payload.items.push({ index, ok: true });
  }

  assert.deepEqual(normalizeWorkResult(payload), payload);
});
