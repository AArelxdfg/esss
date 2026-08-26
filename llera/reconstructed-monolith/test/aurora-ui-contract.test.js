'use strict';

const assert = require('node:assert/strict');
const { AuroraUIContract, REQUIRED_SURFACES } = require('../src/aurora-ui-contract');

const ui = new AuroraUIContract({ viewportWidth: 1440, prefersReducedMotion: false });
assert.equal(ui.selfTest().ok, true);
assert.deepEqual(REQUIRED_SURFACES, ['conversation', 'work', 'activity', 'evidence', 'system-models']);
assert.equal(ui.getResponsiveLayout().sidebar, 'persistent');
assert.equal(ui.setViewportWidth(980).sidebar, 'collapsed');
assert.equal(ui.setViewportWidth(640).sidebar, 'overlay');

const reduced = new AuroraUIContract({ prefersReducedMotion: true });
assert.deepEqual(reduced.getMotionPolicy(), { enabled: false, durationMs: 0, scrollBehavior: 'auto' });

let state = ui.handleShortcut({ key: 'k', ctrlKey: true });
assert.equal(state.open, true);
assert.equal(state.role, 'dialog');
assert.equal(state.listRole, 'listbox');

ui.setPaletteQuery('evidence');
state = ui.getPaletteState();
assert.equal(state.items.length, 1);
assert.equal(state.items[0].surface, 'evidence');

const activation = ui.handleShortcut({ key: 'Enter' });
assert.equal(activation.handled, true);
assert.equal(activation.surface, 'evidence');
assert.equal(ui.getNavigationState().find((x) => x.surface === 'evidence').ariaCurrent, 'page');

ui.openPalette();
const first = ui.getPaletteState().activeIndex;
ui.handleShortcut({ key: 'ArrowDown' });
assert.notEqual(ui.getPaletteState().activeIndex, first);
assert.equal(ui.handleShortcut({ key: 'Escape' }).action, 'close');
assert.equal(ui.getPaletteState().open, false);

let composer = ui.updateComposer('   ');
assert.equal(composer.sendDisabled, true);
composer = ui.updateComposer('Analyze this workspace');
assert.equal(composer.sendDisabled, false);
composer = ui.setComposerFocus(true);
assert.equal(composer.focusVisible, true);
assert.ok(composer.focusRingMinPx >= 2);

const a11y = ui.getAccessibilityContract();
assert.equal(a11y.keyboardPalette, 'Ctrl/Cmd+K');
assert.equal(a11y.reducedMotionRespected, true);
assert.equal(a11y.activeNavigationUsesAriaCurrent, true);

console.log('AURORA UI behavior parity PASS', {
  schema: ui.selfTest().schema,
  surfaces: ui.selfTest().surfaces,
  paletteCommands: ui.selfTest().paletteCommands,
});
