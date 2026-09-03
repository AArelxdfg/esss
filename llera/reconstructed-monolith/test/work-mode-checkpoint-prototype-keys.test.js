'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeWorkResult } = require('../app/services/work-mode-service.cjs');

for (const key of ['__proto__', 'prototype', 'constructor']) {
  test(`Work Mode rejects reserved durable checkpoint key ${key}`, () => {
    const payload = Object.create(null);
    payload.safe = true;
    payload[key] = { polluted: true };

    assert.throws(
      () => normalizeWorkResult(payload),
      error => error && error.code === 'WORK_MODE_RESULT_INVALID' && error.path === `result.${key}` && /reserved key/.test(error.message)
    );
  });
}

test('Work Mode still accepts ordinary nested durable checkpoint keys', () => {
  const payload = {
    result: {
      tool: 'read_file',
      target: 'workspace/output.txt',
      evidence: { id: 'ev_test', sha256: 'a'.repeat(64) }
    }
  };

  assert.deepEqual(normalizeWorkResult(payload), payload);
});
