'use strict';

const { AuroraFocusTrap } = require('./aurora-focus-trap');

class AuroraAccessibilityController {
  constructor({ ui, focusTrap = new AuroraFocusTrap() } = {}) {
    if (!ui || typeof ui.handleShortcut !== 'function') throw new Error('AURORA UI contract is required');
    if (!focusTrap || typeof focusTrap.handleTab !== 'function') throw new Error('AURORA focus trap is required');
    this.ui = ui;
    this.focusTrap = focusTrap;
  }

  getNavigationState() { return this.ui.getNavigationState(); }
  getResponsiveLayout() { return this.ui.getResponsiveLayout(); }
  getMotionPolicy() { return this.ui.getMotionPolicy(); }
  getAccessibilityContract() {
    const base = this.ui.getAccessibilityContract ? this.ui.getAccessibilityContract() : {};
    return {
      ...base,
      paletteUsesCyclicFocusTrap: true,
      paletteContainsExternalFocus: true,
      paletteSupportsReverseTab: true,
    };
  }
  getComposerState() { return this.ui.getComposerState ? this.ui.getComposerState() : null; }
  setSurface(surface) { return this.ui.setSurface(surface); }
  handleNavigationKey(event) { return this.ui.handleNavigationKey ? this.ui.handleNavigationKey(event) : { handled: false }; }
  updateComposer(value) { return this.ui.updateComposer ? this.ui.updateComposer(value) : null; }
  setComposerFocus(focused) { return this.ui.setComposerFocus ? this.ui.setComposerFocus(focused) : null; }
  announce(message, politeness) { return this.ui.announce ? this.ui.announce(message, politeness) : null; }

  getPaletteState() {
    const state = this.ui.getPaletteState();
    return {
      ...state,
      focusTrap: this.focusTrap.getState(),
      focusTarget: this.focusTrap.getState().active ? this.focusTrap.getState().focusTarget : state.focusTarget,
    };
  }

  handleShortcut(event = {}) {
    const key = String(event.key || '').toLowerCase();
    const modifier = Boolean(event.ctrlKey || event.metaKey);

    if (modifier && key === 'k') {
      if (this.ui.getPaletteState().open) {
        const uiResult = this.ui.handleShortcut(event);
        const trapResult = this.focusTrap.deactivate({ restoreFocus: true });
        return { ...uiResult, focusTarget: trapResult.focusTarget, focusTrap: trapResult };
      }
      const uiResult = this.ui.handleShortcut(event);
      const trapResult = this.focusTrap.activate({
        initialFocus: 'aurora-command-search',
        returnFocusTo: event.focusOrigin || 'composer',
      });
      return { ...uiResult, focusTarget: trapResult.focusTarget, focusTrap: trapResult };
    }

    if (!this.ui.getPaletteState().open) return this.ui.handleShortcut(event);

    if (key === 'tab') {
      const trapped = this.focusTrap.handleTab({ shiftKey: Boolean(event.shiftKey) });
      return { ...trapped, state: this.getPaletteState() };
    }

    if (key === 'escape') {
      const uiResult = this.ui.handleShortcut(event);
      const trapResult = this.focusTrap.deactivate({ restoreFocus: true });
      return { ...uiResult, focusTarget: trapResult.focusTarget, focusTrap: trapResult };
    }

    if (key === 'enter') {
      const before = this.ui.getPaletteState();
      const uiResult = this.ui.handleShortcut(event);
      if (before.open && !this.ui.getPaletteState().open && uiResult.action === 'activate') {
        const trapResult = this.focusTrap.deactivate({ restoreFocus: true });
        return { ...uiResult, focusTarget: trapResult.focusTarget, focusTrap: trapResult };
      }
      return uiResult;
    }

    return this.ui.handleShortcut(event);
  }

  containFocus(target) {
    if (!this.ui.getPaletteState().open) return { handled: false, reason: 'palette-closed' };
    return this.focusTrap.containExternalFocus(target);
  }

  selfTest() {
    const focus = this.focusTrap.selfTest();
    const base = typeof this.ui.selfTest === 'function' ? this.ui.selfTest() : { ok: true };
    return {
      ok: Boolean(base.ok && focus.ok),
      schema: 542,
      ui: base,
      focusTrap: focus,
      accessibility: this.getAccessibilityContract(),
    };
  }
}

module.exports = { AuroraAccessibilityController };
