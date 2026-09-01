'use strict';

const assert = require('assert');
const { AuroraUIContract, REQUIRED_SURFACES } = require('../src/aurora-ui-contract');
const { AuroraMonolithViewModel } = require('../src/aurora-monolith-view-model');

(async () => {
  const ui = new AuroraUIContract({ activeSurface: 'conversation' });

  let result = ui.handleNavigationKey({ key: 'ArrowDown' });
  assert.strictEqual(result.handled, true);
  assert.strictEqual(result.action, 'move-activate');
  assert.strictEqual(result.surface, 'work');
  assert.strictEqual(result.focusTarget, 'nav-work');
  assert.strictEqual(ui.activeSurface, 'work');

  result = ui.handleNavigationKey({ key: 'ArrowLeft' });
  assert.strictEqual(result.surface, 'conversation');

  result = ui.handleNavigationKey({ key: 'End' });
  assert.strictEqual(result.surface, 'system-models');
  assert.strictEqual(result.focusTarget, 'nav-system-models');

  result = ui.handleNavigationKey({ key: 'ArrowRight' });
  assert.strictEqual(result.surface, 'conversation', 'navigation must wrap');

  result = ui.handleNavigationKey({ key: 'Home' });
  assert.strictEqual(result.surface, 'conversation');

  const nav = ui.getNavigationState();
  assert.strictEqual(nav.length, REQUIRED_SURFACES.length);
  assert(nav.every(item => item.role === 'tab'));
  assert(nav.every(item => typeof item.ariaSelected === 'boolean'));
  assert(nav.every(item => item.ariaControls === `surface-${item.surface}`));
  assert.strictEqual(nav.filter(item => item.tabIndex === 0).length, 1);

  ui.openPalette();
  const blocked = ui.handleNavigationKey({ key: 'ArrowDown' });
  assert.strictEqual(blocked.handled, false);
  assert.strictEqual(blocked.reason, 'palette-open');
  ui.closePalette();

  const vm = new AuroraMonolithViewModel({
    ui,
    runtime: { snapshot: async () => ({ state:'ready', model:'qwen3-next-80b-q4km', generation:1 }) },
    missionEngine: { listMissions: async () => [] },
    evidenceLedger: { export: async () => [] },
    hostguard: { status: async () => ({ pressure:'normal', policy:{ pressure:'normal', downloadWorkers:8, allowVisionLoad:true } }) }
  });

  const bridged = await vm.handleNavigationKey({ key: 'ArrowDown' });
  assert.strictEqual(bridged.result.surface, 'work');
  assert.strictEqual(bridged.model.navigation.find(x => x.surface === 'work').active, true);
  assert.strictEqual(bridged.model.schema, 5401);

  const self = ui.selfTest();
  assert.strictEqual(self.ok, true);
  assert.strictEqual(self.schema, 545);
  assert.strictEqual(self.tabSemanticsValid, true);
  assert.strictEqual(self.accessibility.navigationKeyboardOperable, true);

  console.log('MONOLITH AURORA surface keyboard navigation PASS', {
    arrowNavigation: true,
    wraparound: true,
    homeEnd: true,
    rovingTabIndex: true,
    tabSemantics: true,
    paletteIsolation: true,
    liveViewModelBridge: true
  });
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
