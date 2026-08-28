'use strict';

const REQUIRED_SURFACES = Object.freeze([
  'conversation',
  'work',
  'activity',
  'evidence',
  'system-models',
]);

const PALETTE_COMMANDS = Object.freeze([
  { id: 'new-chat', label: 'New conversation', surface: 'conversation' },
  { id: 'open-work', label: 'Open Work Mode', surface: 'work' },
  { id: 'open-activity', label: 'Show Activity', surface: 'activity' },
  { id: 'open-evidence', label: 'Show Evidence', surface: 'evidence' },
  { id: 'open-system-models', label: 'System & Models', surface: 'system-models' },
]);

function normalizeText(value) {
  return String(value || '').trim().toLocaleLowerCase('en-US');
}

class AuroraUIContract {
  constructor(options = {}) {
    this.prefersReducedMotion = Boolean(options.prefersReducedMotion);
    this.viewportWidth = Number.isFinite(options.viewportWidth) ? options.viewportWidth : 1440;
    this.activeSurface = REQUIRED_SURFACES.includes(options.activeSurface)
      ? options.activeSurface
      : 'conversation';
    this.palette = {
      open: false,
      query: '',
      activeIndex: 0,
      returnFocusTo: null,
      focusTarget: null,
    };
    this.composer = { focused: false, value: '', canSend: false };
    this.announcement = { message: '', politeness: 'polite', revision: 0 };
  }

  getMotionPolicy() {
    return this.prefersReducedMotion
      ? { enabled: false, durationMs: 0, scrollBehavior: 'auto' }
      : { enabled: true, durationMs: 160, scrollBehavior: 'smooth' };
  }

  getResponsiveLayout() {
    if (this.viewportWidth < 760) {
      return { mode: 'compact', sidebar: 'overlay', activityDock: 'stacked', density: 'comfortable' };
    }
    if (this.viewportWidth < 1120) {
      return { mode: 'medium', sidebar: 'collapsed', activityDock: 'stacked', density: 'comfortable' };
    }
    return { mode: 'wide', sidebar: 'persistent', activityDock: 'side', density: 'balanced' };
  }

  setViewportWidth(width) {
    if (!Number.isFinite(width) || width <= 0) throw new TypeError('viewport width must be positive');
    this.viewportWidth = width;
    return this.getResponsiveLayout();
  }

  setSurface(surface) {
    if (!REQUIRED_SURFACES.includes(surface)) throw new Error(`unknown MONOLITH surface: ${surface}`);
    this.activeSurface = surface;
    this.announce(`${surface} opened`);
    return surface;
  }

  getNavigationState() {
    return REQUIRED_SURFACES.map((surface) => ({
      surface,
      active: surface === this.activeSurface,
      ariaCurrent: surface === this.activeSurface ? 'page' : undefined,
      tabIndex: surface === this.activeSurface ? 0 : -1,
    }));
  }

  openPalette({ returnFocusTo = 'composer' } = {}) {
    this.palette.open = true;
    this.palette.query = '';
    this.palette.activeIndex = 0;
    this.palette.returnFocusTo = String(returnFocusTo || 'composer');
    this.palette.focusTarget = 'aurora-command-search';
    this.announce('Command palette opened');
    return this.getPaletteState();
  }

  closePalette({ restoreFocus = true } = {}) {
    const returnFocusTo = this.palette.returnFocusTo || 'composer';
    this.palette.open = false;
    this.palette.query = '';
    this.palette.activeIndex = 0;
    this.palette.focusTarget = restoreFocus ? returnFocusTo : null;
    this.palette.returnFocusTo = null;
    this.announce('Command palette closed');
    return this.getPaletteState();
  }

  setPaletteQuery(query) {
    this.palette.query = String(query || '');
    const items = this.getPaletteItems();
    if (this.palette.activeIndex >= items.length) this.palette.activeIndex = 0;
    this.announce(items.length === 1 ? '1 command available' : `${items.length} commands available`);
    return items;
  }

  getPaletteItems() {
    const q = normalizeText(this.palette.query);
    if (!q) return [...PALETTE_COMMANDS];
    return PALETTE_COMMANDS.filter((command) => {
      const haystack = normalizeText(`${command.id} ${command.label} ${command.surface}`);
      return haystack.includes(q);
    });
  }

  getPaletteState() {
    const items = this.getPaletteItems();
    const active = items.length ? items[this.palette.activeIndex] : null;
    return {
      ...this.palette,
      role: 'dialog',
      ariaModal: true,
      ariaLabel: 'MONOLITH command palette',
      searchRole: 'combobox',
      searchAriaExpanded: this.palette.open,
      searchAriaControls: 'aurora-command-list',
      searchAriaAutocomplete: 'list',
      listRole: 'listbox',
      listId: 'aurora-command-list',
      items: items.map((item, index) => ({
        ...item,
        id: `aurora-command-${item.id}`,
        role: 'option',
        ariaSelected: index === this.palette.activeIndex,
      })),
      activeDescendant: active ? `aurora-command-${active.id}` : undefined,
      emptyState: items.length ? null : {
        role: 'status',
        message: 'No matching commands',
      },
    };
  }

  handleShortcut(event = {}) {
    const key = String(event.key || '').toLowerCase();
    const modifier = Boolean(event.ctrlKey || event.metaKey);
    if (modifier && key === 'k') {
      const action = this.palette.open ? 'close' : 'open';
      const state = this.palette.open
        ? this.closePalette()
        : this.openPalette({ returnFocusTo: event.focusOrigin || 'composer' });
      return { ...state, handled: true, action };
    }
    if (!this.palette.open) return { handled: false };

    const items = this.getPaletteItems();
    if (key === 'escape') return { handled: true, action: 'close', state: this.closePalette() };
    if (key === 'tab') {
      return {
        handled: true,
        action: 'trap-focus',
        focusTarget: 'aurora-command-search',
      };
    }
    if (!items.length) {
      if (key === 'enter' || key === 'arrowdown' || key === 'arrowup') {
        return { handled: true, action: 'noop-empty', state: this.getPaletteState() };
      }
      return { handled: false };
    }

    if (key === 'arrowdown') {
      this.palette.activeIndex = (this.palette.activeIndex + 1) % items.length;
      return { handled: true, action: 'move', state: this.getPaletteState() };
    }
    if (key === 'arrowup') {
      this.palette.activeIndex = (this.palette.activeIndex - 1 + items.length) % items.length;
      return { handled: true, action: 'move', state: this.getPaletteState() };
    }
    if (key === 'home') {
      this.palette.activeIndex = 0;
      return { handled: true, action: 'move', state: this.getPaletteState() };
    }
    if (key === 'end') {
      this.palette.activeIndex = items.length - 1;
      return { handled: true, action: 'move', state: this.getPaletteState() };
    }
    if (key === 'enter') {
      const command = items[this.palette.activeIndex];
      const focusAfterClose = this.palette.returnFocusTo || 'composer';
      this.setSurface(command.surface);
      const closed = this.closePalette({ restoreFocus: false });
      closed.focusTarget = focusAfterClose;
      return {
        handled: true,
        action: 'activate',
        command,
        surface: this.activeSurface,
        focusTarget: focusAfterClose,
      };
    }
    return { handled: false };
  }

  updateComposer(value) {
    this.composer.value = String(value ?? '');
    this.composer.canSend = this.composer.value.trim().length > 0;
    return this.getComposerState();
  }

  setComposerFocus(focused) {
    this.composer.focused = Boolean(focused);
    return this.getComposerState();
  }

  getComposerState() {
    return {
      ...this.composer,
      role: 'textbox',
      ariaLabel: 'Message LLera',
      ariaMultiline: true,
      multiline: true,
      sendDisabled: !this.composer.canSend,
      sendAriaDisabled: !this.composer.canSend,
      focusVisible: this.composer.focused,
      focusRingMinPx: 2,
    };
  }

  announce(message, politeness = 'polite') {
    this.announcement = {
      message: String(message || ''),
      politeness: politeness === 'assertive' ? 'assertive' : 'polite',
      revision: this.announcement.revision + 1,
    };
    return this.getLiveRegionState();
  }

  getLiveRegionState() {
    return {
      role: 'status',
      ariaLive: this.announcement.politeness,
      ariaAtomic: true,
      message: this.announcement.message,
      revision: this.announcement.revision,
    };
  }

  getAccessibilityContract() {
    return {
      skipToComposer: true,
      keyboardPalette: 'Ctrl/Cmd+K',
      paletteNavigation: ['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', 'Escape', 'Tab'],
      focusVisible: true,
      reducedMotionRespected: true,
      minFocusRingPx: 2,
      activeNavigationUsesAriaCurrent: true,
      activeNavigationUsesRovingTabIndex: true,
      composerHasExplicitDisabledState: true,
      composerHasAccessibleName: true,
      paletteIsModalDialog: true,
      paletteRestoresFocus: true,
      paletteExposesActiveDescendant: true,
      paletteHandlesEmptyResults: true,
      liveRegionForStateChanges: true,
    };
  }

  selfTest() {
    const surfacesPresent = REQUIRED_SURFACES.every((surface) =>
      this.getNavigationState().some((item) => item.surface === surface));
    const a11y = this.getAccessibilityContract();
    const layout = this.getResponsiveLayout();
    const motion = this.getMotionPolicy();
    const nav = this.getNavigationState();
    const rovingTabIndexValid =
      nav.filter(item => item.tabIndex === 0).length === 1 &&
      nav.find(item => item.tabIndex === 0)?.active === true;
    return {
      ok: surfacesPresent &&
        a11y.focusVisible &&
        a11y.reducedMotionRespected &&
        a11y.paletteRestoresFocus &&
        a11y.liveRegionForStateChanges &&
        rovingTabIndexValid,
      schema: 541,
      surfaces: REQUIRED_SURFACES.length,
      paletteCommands: PALETTE_COMMANDS.length,
      layout,
      motion,
      accessibility: a11y,
      rovingTabIndexValid,
    };
  }
}

module.exports = { AuroraUIContract, REQUIRED_SURFACES, PALETTE_COMMANDS };
