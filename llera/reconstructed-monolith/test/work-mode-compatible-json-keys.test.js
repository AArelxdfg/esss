'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeWorkResult } = require('../app/services/work-mode-service.cjs');

test('Work Mode preserves ordinary constructor/prototype JSON keys across checkpoint normalization', () => {
  const payload = JSON.parse('{"constructor":{"status":"verified"},"prototype":{"count":2},"nested":{"constructor":"ok","prototype":true}}');

  assert.deepEqual(normalizeWorkResult(payload), payload);
});

test('Work Mode still rejects own __proto__ keys while preserving compatible JSON keys', () => {
  const payload = JSON.parse('{"constructor":"compatible","prototype":"compatible","__proto__":{"polluted":true}}');

  assert.throws(
    () => normalizeWorkResult(payload),
    error => error && error.code === 'WORK_MODE_RESULT_INVALID' && error.path === 'result.__proto__'
  );
  assert.equal({}.polluted, undefined);
});
