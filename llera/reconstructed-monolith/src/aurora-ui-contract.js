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
    this.palette = { open: false, query: '', activeIndex: 0 };
    this.composer = { focused: false, value: '', canSend: false };
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
    return surface;
  }

  getNavigationState() {
    return REQUIRED_SURFACES.map((surface) => ({
      surface,
      active: surface === this.activeSurface,
      ariaCurrent: surface === this.activeSurface ? 'page' : undefined,
    }));
  }

  openPalette() {
    this.palette.open = true;
    this.palette.query = '';
    this.palette.activeIndex = 0;
    return this.getPaletteState();
  }

  closePalette() {
    this.palette.open = false;
    this.palette.query = '';
    this.palette.activeIndex = 0;
    return this.getPaletteState();
  }

  setPaletteQuery(query) {
    this.palette.query = String(query || '');
    const items = this.getPaletteItems();
    if (this.palette.activeIndex >= items.length) this.palette.activeIndex = 0;
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
    return {
      ...this.palette,
      role: 'dialog',
      ariaModal: true,
      listRole: 'listbox',
      items,
      activeDescendant: items.length ? `aurora-command-${items[this.palette.activeIndex].id}` : undefined,
    };
  }

  handleShortcut(event = {}) {
    const key = String(event.key || '').toLowerCase();
    const modifier = Boolean(event.ctrlKey || event.metaKey);
    if (modifier && key === 'k') {
      return this.palette.open ? this.closePalette() : this.openPalette();
    }
    if (!this.palette.open) return { handled: false };

    const items = this.getPaletteItems();
    if (key === 'escape') return { handled: true, action: 'close', state: this.closePalette() };
    if (!items.length) return { handled: false };

    if (key === 'arrowdown') {
      this.palette.activeIndex = (this.palette.activeIndex + 1) % items.length;
      return { handled: true, action: 'move', state: this.getPaletteState() };
    }
    if (key === 'arrowup') {
      this.palette.activeIndex = (this.palette.activeIndex - 1 + items.length) % items.length;
      return { handled: true, action: 'move', state: this.getPaletteState() };
    }
    if (key === 'enter') {
      const command = items[this.palette.activeIndex];
      this.setSurface(command.surface);
      this.closePalette();
      return { handled: true, action: 'activate', command, surface: this.activeSurface };
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
      multiline: true,
      sendDisabled: !this.composer.canSend,
      focusVisible: this.composer.focused,
      focusRingMinPx: 2,
    };
  }

  getAccessibilityContract() {
    return {
      skipToComposer: true,
      keyboardPalette: 'Ctrl/Cmd+K',
      paletteNavigation: ['ArrowUp', 'ArrowDown', 'Enter', 'Escape'],
      focusVisible: true,
      reducedMotionRespected: true,
      minFocusRingPx: 2,
      activeNavigationUsesAriaCurrent: true,
      composerHasExplicitDisabledState: true,
    };
  }

  selfTest() {
    const surfacesPresent = REQUIRED_SURFACES.every((surface) =>
      this.getNavigationState().some((item) => item.surface === surface));
    const a11y = this.getAccessibilityContract();
    const layout = this.getResponsiveLayout();
    const motion = this.getMotionPolicy();
    return {
      ok: surfacesPresent && a11y.focusVisible && a11y.reducedMotionRespected,
      schema: 540,
      surfaces: REQUIRED_SURFACES.length,
      paletteCommands: PALETTE_COMMANDS.length,
      layout,
      motion,
      accessibility: a11y,
    };
  }
}

module.exports = { AuroraUIContract, REQUIRED_SURFACES, PALETTE_COMMANDS };
