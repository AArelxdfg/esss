'use strict';

const assert = require('assert');
const { AuroraUIContract } = require('../src/aurora-ui-contract');
const { AuroraAccessibilityController, sanitizeFocusOrigin } = require('../src/aurora-accessibility-controller');

assert.strictEqual(sanitizeFocusOrigin(' nav-work '), 'nav-work');
assert.strictEqual(sanitizeFocusOrigin('composer'), 'composer');
assert.strictEqual(sanitizeFocusOrigin('outside control'), 'composer');
assert.strictEqual(sanitizeFocusOrigin('nav-work\nattacker'), 'composer');
assert.strictEqual(sanitizeFocusOrigin('x'.repeat(129)), 'composer');
assert.strictEqual(sanitizeFocusOrigin(''), 'composer');

const ui = new AuroraUIContract({ viewportWidth: 1440 });
const controller = new AuroraAccessibilityController({ ui });

const openedUnsafe = controller.handleShortcut({
  key: 'k',
  ctrlKey: true,
  focusOrigin: 'nav-work\nexternal-target',
});
assert.strictEqual(openedUnsafe.action, 'open');
assert.strictEqual(openedUnsafe.focusTrap.returnFocusTo, 'composer');
assert.strictEqual(ui.getPaletteState().returnFocusTo, 'composer');

const escapedUnsafe = controller.handleShortcut({ key: 'Escape' });
assert.strictEqual(escapedUnsafe.action, 'close');
assert.strictEqual(escapedUnsafe.focusTarget, 'composer');

const openedSafe = controller.handleShortcut({ key: 'k', ctrlKey: true, focusOrigin: 'nav-work' });
assert.strictEqual(openedSafe.focusTrap.returnFocusTo, 'nav-work');
const escapedSafe = controller.handleShortcut({ key: 'Escape' });
assert.strictEqual(escapedSafe.focusTarget, 'nav-work');

const a11y = controller.getAccessibilityContract();
assert.strictEqual(a11y.paletteReturnFocusOriginSanitized, true);
const self = controller.selfTest();
assert.strictEqual(self.ok, true);
assert.strictEqual(self.schema, 545);
assert.strictEqual(self.accessibility.paletteReturnFocusOriginSanitized, true);

console.log('AURORA return focus origin sanitization PASS', {
  malformedOriginFallsBackToComposer: true,
  validDomIdPreserved: true,
  focusRestorationBounded: true,
});
