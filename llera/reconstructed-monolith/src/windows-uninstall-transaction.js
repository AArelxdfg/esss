'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

async function exists(p) { try { await fsp.access(p); return true; } catch { return false; } }

const SHORTCUT_SCOPES = Object.freeze(['desktop', 'start-menu', 'startup', 'taskbar']);
const CORE_STEPS = Object.freeze([
  'stop-app',
  ...SHORTCUT_SCOPES.map(scope => `remove-shortcut:${scope}`),
  'remove-shortcuts',
  'unregister-app',
  'remove-app',
  'remove-staging',
  'remove-rollback',
  'remove-quarantine',
  'remove-data',
  'remove-models',
]);
const ALLOWED_STEPS = new Set(CORE_STEPS);

class WindowsUninstallTransaction {
  constructor({ rootDir, stopApp, removeShortcut, unregisterApp, now = () => Date.now() } = {}) {
    if (!rootDir) throw new Error('rootDir is required');
    this.rootDir = path.resolve(rootDir);
    this.stopApp = stopApp || (async () => {});
    this.removeShortcut = removeShortcut || (async () => {});
    this.unregisterApp = unregisterApp || (async () => {});
    this.now = now;
    this.journal = path.join(this.rootDir, 'uninstall-journal.json');
  }

  async begin({ keepData = true, keepModels = true } = {}) {
    const existing = await this._read();
    if (existing && existing.state !== 'uninstalled') {
      throw new Error('uninstall already in progress; resume existing intent instead of replacing it');
    }

    const intent = {
      schema: 3,
      state: 'uninstall-intent',
      keepData: Boolean(keepData),
      keepModels: Boolean(keepModels),
      completed: [],
      at: this.now()
    };
    await this._write(intent);
    return this.resume({
      confirmDataDeletion: !intent.keepData,
      confirmModelDeletion: !intent.keepModels
    });
  }

  async resume({ confirmDataDeletion = false, confirmModelDeletion = false } = {}) {
    const state = await this._read();
    if (!state) return { resumed: false, reason: 'no-uninstall-intent' };
    if (state.state === 'uninstalled') return { resumed: false, reason: 'already-uninstalled', state };
    if (state.state !== 'uninstall-intent' && state.state !== 'uninstalling') {
      throw new Error(`unsupported uninstall journal state: ${state.state}`);
    }

    if (!state.keepData && !confirmDataDeletion) {
      throw new Error('destructive uninstall resume requires explicit data deletion confirmation');
    }
    if (!state.keepModels && !confirmModelDeletion) {
      throw new Error('destructive uninstall resume requires explicit model deletion confirmation');
    }

    state.state = 'uninstalling';
    await this._write(state);

    await this._step(state, 'stop-app', async () => this.stopApp());

    for (const scope of SHORTCUT_SCOPES) {
      await this._step(state, `remove-shortcut:${scope}`, async () => this.removeShortcut(scope));
    }
    await this._step(state, 'remove-shortcuts', async () => {});

    await this._step(state, 'unregister-app', async () => this.unregisterApp());
    await this._step(state, 'remove-app', async () => fsp.rm(path.join(this.rootDir, 'app'), { recursive: true, force: true }));
    await this._step(state, 'remove-staging', async () => fsp.rm(path.join(this.rootDir, 'staging'), { recursive: true, force: true }));
    await this._step(state, 'remove-rollback', async () => fsp.rm(path.join(this.rootDir, 'rollback'), { recursive: true, force: true }));
    await this._step(state, 'remove-quarantine', async () => fsp.rm(path.join(this.rootDir, 'repair-quarantine'), { recursive: true, force: true }));
    if (!state.keepData) await this._step(state, 'remove-data', async () => fsp.rm(path.join(this.rootDir, 'data'), { recursive: true, force: true }));
    if (!state.keepModels) await this._step(state, 'remove-models', async () => fsp.rm(path.join(this.rootDir, 'models'), { recursive: true, force: true }));

    state.state = 'uninstalled';
    state.finishedAt = this.now();
    await this._write(state);
    return { resumed: true, uninstalled: true, keepData: state.keepData, keepModels: state.keepModels, completed: [...state.completed] };
  }

  async _step(state, name, fn) {
    if (state.completed.includes(name)) return;
    await fn();
    state.completed.push(name);
    state.lastCompleted = name;
    state.updatedAt = this.now();
    await this._write(state);
  }

  async _read() {
    if (!await exists(this.journal)) return null;
    let value;
    try { value = JSON.parse(await fsp.readFile(this.journal, 'utf8')); }
    catch { throw new Error('uninstall journal corrupt; refusing destructive recovery'); }

    this._validateJournal(value);
    return value;
  }

  _validateJournal(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('uninstall journal invalid; refusing destructive recovery');
    }
    if (![1, 2, 3].includes(value.schema)) {
      throw new Error('uninstall journal schema unsupported; refusing destructive recovery');
    }
    if (!['uninstall-intent', 'uninstalling', 'uninstalled'].includes(value.state)) {
      throw new Error('uninstall journal state invalid; refusing destructive recovery');
    }
    if (typeof value.keepData !== 'boolean' || typeof value.keepModels !== 'boolean' || !Array.isArray(value.completed)) {
      throw new Error('uninstall journal invalid; refusing destructive recovery');
    }
    const unique = new Set(value.completed);
    if (unique.size !== value.completed.length || value.completed.some(step => typeof step !== 'string' || !ALLOWED_STEPS.has(step))) {
      throw new Error('uninstall journal steps invalid; refusing destructive recovery');
    }

    if (value.schema >= 2 && value.completed.includes('remove-shortcuts')) {
      for (const scope of SHORTCUT_SCOPES) {
        if (!value.completed.includes(`remove-shortcut:${scope}`)) {
          throw new Error('uninstall journal shortcut completion inconsistent; refusing destructive recovery');
        }
      }
    }
  }

  async _write(value) {
    await fsp.mkdir(this.rootDir, { recursive: true });
    const tmp = `${this.journal}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
    await fsp.rename(tmp, this.journal);
  }
}

module.exports = { WindowsUninstallTransaction, SHORTCUT_SCOPES };
