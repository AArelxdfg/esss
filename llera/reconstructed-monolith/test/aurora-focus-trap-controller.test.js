'use strict';

const assert = require('assert');
const { AuroraUIContract } = require('../src/aurora-ui-contract');
const { AuroraAccessibilityController } = require('../src/aurora-accessibility-controller');

const ui = new AuroraUIContract({ viewportWidth: 1440 });
const controller = new AuroraAccessibilityController({ ui });

const opened = controller.handleShortcut({ key: 'k', ctrlKey: true, focusOrigin: 'nav-work' });
assert.strictEqual(opened.handled, true);
assert.strictEqual(opened.action, 'open');
assert.strictEqual(opened.focusTarget, 'aurora-command-search');
assert.strictEqual(opened.focusTrap.active, true);
assert.strictEqual(opened.focusTrap.returnFocusTo, 'nav-work');

const forward1 = controller.handleShortcut({ key: 'Tab' });
assert.strictEqual(forward1.action, 'trap-focus');
assert.strictEqual(forward1.direction, 'forward');
assert.strictEqual(forward1.focusTarget, 'aurora-command-list');

const forward2 = controller.handleShortcut({ key: 'Tab' });
assert.strictEqual(forward2.focusTarget, 'aurora-command-close');
const forwardWrap = controller.handleShortcut({ key: 'Tab' });
assert.strictEqual(forwardWrap.focusTarget, 'aurora-command-search');

const backwardWrap = controller.handleShortcut({ key: 'Tab', shiftKey: true });
assert.strictEqual(backwardWrap.direction, 'backward');
assert.strictEqual(backwardWrap.focusTarget, 'aurora-command-close');

const contained = controller.containFocus('outside-app-control');
assert.strictEqual(contained.handled, true);
assert.strictEqual(contained.action, 'restore-contained-focus');
assert.strictEqual(contained.focusTarget, 'aurora-command-close');

const inside = controller.containFocus('aurora-command-list');
assert.strictEqual(inside.handled, true);
assert.strictEqual(inside.focusTarget, 'aurora-command-list');

const escaped = controller.handleShortcut({ key: 'Escape' });
assert.strictEqual(escaped.handled, true);
assert.strictEqual(ui.getPaletteState().open, false);
assert.strictEqual(escaped.focusTarget, 'nav-work');
assert.strictEqual(escaped.focusTrap.active, false);

controller.handleShortcut({ key: 'k', ctrlKey: true, focusOrigin: 'composer' });
ui.setPaletteQuery('work');
const activated = controller.handleShortcut({ key: 'Enter' });
assert.strictEqual(activated.action, 'activate');
assert.strictEqual(activated.surface, 'work');
assert.strictEqual(activated.focusTarget, 'nav-work');
assert.strictEqual(activated.focusTrap.focusTarget, 'nav-work');
assert.strictEqual(ui.getPaletteState().open, false);
assert.ok(activated.liveRegion);
assert.strictEqual(activated.liveRegion.role, 'status');
assert.strictEqual(activated.liveRegion.ariaLive, 'polite');
assert.strictEqual(activated.liveRegion.message, 'Open Work Mode activated');
assert.strictEqual(ui.getLiveRegionState().message, 'Open Work Mode activated');

const a11y = controller.getAccessibilityContract();
assert.strictEqual(a11y.paletteUsesCyclicFocusTrap, true);
assert.strictEqual(a11y.paletteContainsExternalFocus, true);
assert.strictEqual(a11y.paletteSupportsReverseTab, true);
assert.strictEqual(a11y.paletteActivationAnnounced, true);
assert.strictEqual(a11y.paletteActivationFocusFollowsSurface, true);

const self = controller.selfTest();
assert.strictEqual(self.ok, true);
assert.strictEqual(self.schema, 544);
assert.strictEqual(self.focusTrap.forwardWrap, true);
assert.strictEqual(self.focusTrap.backwardWrap, true);
assert.strictEqual(self.focusTrap.containment, true);
assert.strictEqual(self.focusTrap.focusRestoration, true);
assert.strictEqual(self.accessibility.paletteActivationAnnounced, true);
assert.strictEqual(self.accessibility.paletteActivationFocusFollowsSurface, true);

console.log('AURORA focus trap controller PASS', {
  cyclicTab: true,
  reverseTab: true,
  externalFocusContainment: true,
  focusRestoration: true,
  commandActivationSurfaceFocus: true,
  commandActivationAnnouncement: true,
});
