'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeWorkResult } = require('../app/services/work-mode-service.cjs');

test('Work Mode rejects array accessor indexes without executing the getter', () => {
  let getterCalls = 0;
  const items = [];
  Object.defineProperty(items, '0', {
    enumerable: true,
    configurable: true,
    get() {
      getterCalls += 1;
      return { forged: true };
    }
  });
  items.length = 1;

  assert.throws(
    () => normalizeWorkResult({ items }),
    error => error &&
      error.code === 'WORK_MODE_RESULT_INVALID' &&
      error.path === 'result.items[0]' &&
      /accessor index/.test(error.message)
  );
  assert.equal(getterCalls, 0);
});

test('Work Mode still accepts ordinary dense arrays in durable checkpoint results', () => {
  const payload = { items: [{ id: 'step-1', ok: true }, 'done', 3] };
  assert.deepEqual(normalizeWorkResult(payload), payload);
});
