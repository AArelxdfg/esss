'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AuroraUIContract } = require('../src/aurora-ui-contract');

test('AURORA preserves a valid focus origin across palette close', () => {
  const ui = new AuroraUIContract();
  const opened = ui.openPalette({ returnFocusTo: 'nav-work' });
  assert.equal(opened.returnFocusTo, 'nav-work');

  const closed = ui.closePalette();
  assert.equal(closed.focusTarget, 'nav-work');
});

test('AURORA rejects malformed, injected, control-character, and oversized focus origins', () => {
  const invalid = [
    '',
    '   ',
    '1starts-with-number',
    'bad origin',
    'bad#origin',
    'bad\norigin',
    'bad\rorigin',
    'bad\0origin',
    `a${'x'.repeat(128)}`,
  ];

  for (const focusOrigin of invalid) {
    const ui = new AuroraUIContract();
    const opened = ui.openPalette({ returnFocusTo: focusOrigin });
    assert.equal(opened.returnFocusTo, 'composer', `expected fallback for ${JSON.stringify(focusOrigin)}`);
    const closed = ui.closePalette();
    assert.equal(closed.focusTarget, 'composer');
  }
});

test('Ctrl/Cmd+K shortcut sanitizes untrusted event focusOrigin before storing it', () => {
  const ui = new AuroraUIContract();
  const result = ui.handleShortcut({ ctrlKey: true, key: 'k', focusOrigin: 'evil\nnode' });
  assert.equal(result.handled, true);
  assert.equal(result.action, 'open');
  assert.equal(result.returnFocusTo, 'composer');
});

test('palette command activation cannot leak a tampered stored focus origin', () => {
  const ui = new AuroraUIContract();
  ui.openPalette({ returnFocusTo: 'nav-conversation' });
  ui.palette.returnFocusTo = 'attacker controlled';

  const result = ui.handleShortcut({ key: 'enter' });
  assert.equal(result.handled, true);
  assert.equal(result.action, 'activate');
  assert.equal(result.focusTarget, 'composer');
});

test('AURORA self-test advertises sanitized focus restoration contract', () => {
  const ui = new AuroraUIContract();
  const selfTest = ui.selfTest();
  assert.equal(selfTest.ok, true);
  assert.equal(selfTest.schema, 545);
  assert.equal(selfTest.accessibility.paletteReturnFocusOriginSanitized, true);
});
