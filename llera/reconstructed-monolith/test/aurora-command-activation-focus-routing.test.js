'use strict';

const assert = require('assert');
const { AuroraUIContract } = require('../src/aurora-ui-contract');
const { AuroraAccessibilityController } = require('../src/aurora-accessibility-controller');

const ui = new AuroraUIContract({ viewportWidth: 1440, activeSurface: 'conversation' });
const controller = new AuroraAccessibilityController({ ui });

// Activating a command that keeps the same surface should restore the real origin.
controller.handleShortcut({ key: 'k', ctrlKey: true, focusOrigin: 'composer' });
ui.setPaletteQuery('new conversation');
const sameSurface = controller.handleShortcut({ key: 'Enter' });
assert.strictEqual(sameSurface.action, 'activate');
assert.strictEqual(sameSurface.surface, 'conversation');
assert.strictEqual(sameSurface.focusTarget, 'composer');
assert.strictEqual(sameSurface.focusTrap.focusTarget, 'composer');

// Activating a command that changes surface must not restore focus into a hidden control.
controller.handleShortcut({ key: 'k', ctrlKey: true, focusOrigin: 'composer' });
ui.setPaletteQuery('work');
const work = controller.handleShortcut({ key: 'Enter' });
assert.strictEqual(work.action, 'activate');
assert.strictEqual(work.surface, 'work');
assert.strictEqual(work.focusTarget, 'nav-work');
assert.strictEqual(work.focusTrap.focusTarget, 'nav-work');

// The rule is independent of the old focus origin: the newly active surface owns focus.
controller.handleShortcut({ key: 'k', ctrlKey: true, focusOrigin: 'nav-work' });
ui.setPaletteQuery('evidence');
const evidence = controller.handleShortcut({ key: 'Enter' });
assert.strictEqual(evidence.action, 'activate');
assert.strictEqual(evidence.surface, 'evidence');
assert.strictEqual(evidence.focusTarget, 'nav-evidence');
assert.strictEqual(evidence.focusTrap.focusTarget, 'nav-evidence');
assert.strictEqual(ui.getNavigationState().find(item => item.surface === 'evidence').tabIndex, 0);
assert.strictEqual(ui.getNavigationState().find(item => item.surface === 'evidence').ariaSelected, true);

console.log('AURORA command activation focus routing PASS', {
  sameSurfaceRestoration: true,
  changedSurfaceRoutedToActiveTab: true,
  staleHiddenOriginRejected: true,
});
