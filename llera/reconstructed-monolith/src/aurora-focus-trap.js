'use strict';

const DEFAULT_PALETTE_FOCUS_ORDER = Object.freeze([
  'aurora-command-search',
  'aurora-command-list',
  'aurora-command-close',
]);

class AuroraFocusTrap {
  constructor(options = {}) {
    const requested = Array.isArray(options.focusOrder) ? options.focusOrder : DEFAULT_PALETTE_FOCUS_ORDER;
    const normalized = requested
      .map(value => String(value || '').trim())
      .filter(Boolean);
    if (!normalized.length) throw new Error('AURORA focus trap requires at least one focus target');
    if (new Set(normalized).size !== normalized.length) throw new Error('AURORA focus trap focus targets must be unique');

    this.focusOrder = Object.freeze([...normalized]);
    this.active = false;
    this.index = 0;
    this.returnFocusTo = null;
  }

  activate({ initialFocus, returnFocusTo = 'composer' } = {}) {
    const requested = String(initialFocus || this.focusOrder[0]);
    const found = this.focusOrder.indexOf(requested);
    this.active = true;
    this.index = found >= 0 ? found : 0;
    this.returnFocusTo = String(returnFocusTo || 'composer');
    return this.getState();
  }

  deactivate({ restoreFocus = true } = {}) {
    const focusTarget = restoreFocus ? (this.returnFocusTo || 'composer') : null;
    this.active = false;
    this.index = 0;
    this.returnFocusTo = null;
    return { ...this.getState(), focusTarget };
  }

  setFocusTarget(target) {
    if (!this.active) return { handled: false, reason: 'inactive' };
    const index = this.focusOrder.indexOf(String(target || ''));
    if (index < 0) return { handled: false, reason: 'outside-trap' };
    this.index = index;
    return { handled: true, focusTarget: this.focusOrder[this.index], state: this.getState() };
  }

  handleTab({ shiftKey = false } = {}) {
    if (!this.active) return { handled: false, reason: 'inactive' };
    const delta = shiftKey ? -1 : 1;
    this.index = (this.index + delta + this.focusOrder.length) % this.focusOrder.length;
    return {
      handled: true,
      action: 'trap-focus',
      direction: shiftKey ? 'backward' : 'forward',
      focusTarget: this.focusOrder[this.index],
      state: this.getState(),
    };
  }

  containExternalFocus(target) {
    if (!this.active) return { handled: false, reason: 'inactive' };
    if (this.focusOrder.includes(String(target || ''))) return this.setFocusTarget(target);
    return {
      handled: true,
      action: 'restore-contained-focus',
      focusTarget: this.focusOrder[this.index],
      state: this.getState(),
    };
  }

  getState() {
    return {
      active: this.active,
      focusOrder: [...this.focusOrder],
      focusIndex: this.index,
      focusTarget: this.active ? this.focusOrder[this.index] : null,
      returnFocusTo: this.returnFocusTo,
      wraps: true,
    };
  }

  selfTest() {
    const probe = new AuroraFocusTrap({ focusOrder: this.focusOrder });
    const opened = probe.activate({ returnFocusTo: 'composer' });
    const first = opened.focusTarget === this.focusOrder[0];
    for (let index = 0; index < this.focusOrder.length; index += 1) probe.handleTab();
    const forwardWrap = probe.getState().focusTarget === this.focusOrder[0];
    probe.handleTab({ shiftKey: true });
    const backwardWrap = probe.getState().focusTarget === this.focusOrder[this.focusOrder.length - 1];
    const escaped = probe.containExternalFocus('outside-control');
    const containment = escaped.handled === true && escaped.action === 'restore-contained-focus';
    const closed = probe.deactivate();
    return {
      ok: first && forwardWrap && backwardWrap && containment && closed.focusTarget === 'composer',
      focusTargets: this.focusOrder.length,
      forwardWrap,
      backwardWrap,
      containment,
      focusRestoration: closed.focusTarget === 'composer',
    };
  }
}

module.exports = { AuroraFocusTrap, DEFAULT_PALETTE_FOCUS_ORDER };
