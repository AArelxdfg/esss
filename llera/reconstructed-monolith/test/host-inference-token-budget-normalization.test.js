'use strict';

const assert = require('assert');
const { HostInferenceGovernor, PRIORITY_CLASS } = require('../src/host-inference-governor');

function run() {
  const governor = new HostInferenceGovernor({ pressure: 'normal', now: (() => { let n = 1000; return () => ++n; })() });

  const fractional = governor.admit({
    id: 'fractional',
    className: PRIORITY_CLASS.INTERACTIVE,
    requestedTokens: 123.9
  });
  assert.equal(fractional.allow, true);
  assert.equal(fractional.maxTokens, 123);
  assert.equal(Number.isSafeInteger(fractional.maxTokens), true);
  governor.complete('fractional');

  const nonFinite = governor.admit({
    id: 'non-finite',
    className: PRIORITY_CLASS.MISSION,
    requestedTokens: Infinity
  });
  assert.equal(nonFinite.allow, true);
  assert.equal(nonFinite.maxTokens, 12288);
  assert.equal(Number.isSafeInteger(nonFinite.maxTokens), true);
  governor.complete('non-finite');

  const invalidText = governor.admit({
    id: 'invalid-text',
    className: PRIORITY_CLASS.COUNCIL,
    requestedTokens: 'not-a-number'
  });
  assert.equal(invalidText.allow, true);
  assert.equal(invalidText.maxTokens, 8192);
  assert.equal(Number.isSafeInteger(invalidText.maxTokens), true);
  governor.complete('invalid-text');

  const negative = governor.admit({
    id: 'negative',
    className: PRIORITY_CLASS.ADVERSARIAL,
    requestedTokens: -50
  });
  assert.equal(negative.allow, true);
  assert.equal(negative.maxTokens, 8192);
  assert.equal(Number.isSafeInteger(negative.maxTokens), true);
  governor.complete('negative');

  const overCap = governor.admit({
    id: 'over-cap',
    className: PRIORITY_CLASS.INTERACTIVE,
    requestedTokens: 999999
  });
  assert.equal(overCap.allow, true);
  assert.equal(overCap.maxTokens, 8192);
  assert.equal(Number.isSafeInteger(overCap.maxTokens), true);

  console.log(JSON.stringify({
    pass: true,
    hostguardTokenBudgetNormalization: true,
    integerTokenBudgets: true,
    invalidTokenRequestsFailSafeToClassCap: true
  }));
}

try {
  run();
} catch (err) {
  console.error(err.stack || err);
  process.exit(1);
}
