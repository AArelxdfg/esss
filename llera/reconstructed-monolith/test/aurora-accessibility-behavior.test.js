'use strict';

const assert = require('assert');
const { AuroraUIContract } = require('../src/aurora-ui-contract');

const ui = new AuroraUIContract({ viewportWidth: 1440 });

let open = ui.handleShortcut({ key: 'k', ctrlKey: true, focusOrigin: 'composer' });
assert.strictEqual(open.handled, true);
assert.strictEqual(open.action, 'open');
assert.strictEqual(open.role, 'dialog');
assert.strictEqual(open.ariaModal, true);
assert.strictEqual(open.focusTarget, 'aurora-command-search');
assert.strictEqual(open.searchRole, 'combobox');
assert.strictEqual(open.items[0].role, 'option');
assert.strictEqual(open.items[0].ariaSelected, true);

ui.setPaletteQuery('zzzz-no-match');
let empty = ui.getPaletteState();
assert.strictEqual(empty.items.length, 0);
assert.strictEqual(empty.emptyState.role, 'status');
assert.strictEqual(empty.activeDescendant, undefined);
const emptyEnter = ui.handleShortcut({ key: 'Enter' });
assert.strictEqual(emptyEnter.handled, true);
assert.strictEqual(emptyEnter.action, 'noop-empty');

let closed = ui.handleShortcut({ key: 'Escape' });
assert.strictEqual(closed.handled, true);
assert.strictEqual(closed.state.open, false);
assert.strictEqual(closed.state.focusTarget, 'composer');

ui.openPalette({ returnFocusTo: 'nav-work' });
ui.setPaletteQuery('work');
const activation = ui.handleShortcut({ key: 'Enter' });
assert.strictEqual(activation.surface, 'work');
assert.strictEqual(activation.focusTarget, 'nav-work');

ui.openPalette();
ui.handleShortcut({ key: 'End' });
assert.strictEqual(ui.getPaletteState().activeIndex, ui.getPaletteState().items.length - 1);
ui.handleShortcut({ key: 'Home' });
assert.strictEqual(ui.getPaletteState().activeIndex, 0);

const trap = ui.handleShortcut({ key: 'Tab' });
assert.strictEqual(trap.handled, true);
assert.strictEqual(trap.action, 'trap-focus');

const nav = ui.getNavigationState();
assert.strictEqual(nav.filter(item => item.tabIndex === 0).length, 1);
assert.strictEqual(nav.find(item => item.tabIndex === 0).surface, 'work');

const composer = ui.updateComposer('hello');
assert.strictEqual(composer.ariaLabel, 'Message LLera');
assert.strictEqual(composer.sendAriaDisabled, false);

const live = ui.announce('Mission checkpoint saved');
assert.strictEqual(live.role, 'status');
assert.strictEqual(live.ariaLive, 'polite');
assert.strictEqual(live.ariaAtomic, true);
assert.strictEqual(live.message, 'Mission checkpoint saved');

const reduced = new AuroraUIContract({ prefersReducedMotion: true });
assert.deepStrictEqual(reduced.getMotionPolicy(), {
  enabled: false,
  durationMs: 0,
  scrollBehavior: 'auto'
});

const self = ui.selfTest();
assert.strictEqual(self.ok, true);
assert.strictEqual(self.schema, 541);
assert.strictEqual(self.accessibility.paletteRestoresFocus, true);
assert.strictEqual(self.accessibility.liveRegionForStateChanges, true);

console.log('AURORA accessibility behavior PASS', {
  modalPaletteSemantics: true,
  focusRestoration: true,
  emptyResultKeyboardSafety: true,
  rovingTabIndex: true,
  liveRegion: true,
  reducedMotion: true
});
