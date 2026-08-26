'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function exists(file) {
  try { await fsp.access(file); return true; } catch { return false; }
}

class WindowsInstallLifecycle {
  constructor({ rootDir, healthCheck, launchApp, stopApp, now = () => Date.now() } = {}) {
    if (!rootDir) throw new Error('rootDir is required');
    this.rootDir = path.resolve(rootDir);
    this.healthCheck = healthCheck || (async () => true);
    this.launchApp = launchApp || (async () => {});
    this.stopApp = stopApp || (async () => {});
    this.now = now;
    this.paths = {
      app: path.join(this.rootDir, 'app'),
      backup: path.join(this.rootDir, 'rollback'),
      staging: path.join(this.rootDir, 'staging'),
      journal: path.join(this.rootDir, 'install-journal.json'),
    };
  }

  async init() {
    await Promise.all([
      fsp.mkdir(this.paths.app, { recursive: true }),
      fsp.mkdir(this.paths.backup, { recursive: true }),
      fsp.mkdir(this.paths.staging, { recursive: true }),
    ]);
  }

  async install({ payloadPath, expectedSha256, version, selfTestTimeoutMs = 5000 }) {
    await this.init();
    if (!/^[a-f0-9]{64}$/i.test(expectedSha256 || '')) throw new Error('expectedSha256 invalid');
    if (!version) throw new Error('version required');
    if (!await exists(payloadPath)) throw new Error('payload missing');

    const actual = await sha256File(payloadPath);
    if (actual.toLowerCase() !== expectedSha256.toLowerCase()) throw new Error('payload integrity mismatch');

    const current = path.join(this.paths.app, 'LLera.exe');
    const backup = path.join(this.paths.backup, 'LLera.previous.exe');
    const staged = path.join(this.paths.staging, `LLera-${version}.exe`);
    const hadCurrent = await exists(current);

    if (hadCurrent) {
      await this.stopApp();
      await fsp.copyFile(current, backup);
    }
    await fsp.copyFile(payloadPath, staged);
    const stagedDigest = await sha256File(staged);
    if (stagedDigest !== actual) throw new Error('staging integrity mismatch');
    await this._journal({ state: 'staged', version, staged, sha256: stagedDigest, hadCurrent });

    const tmp = `${current}.new`;
    await fsp.copyFile(staged, tmp);
    await fsp.rename(tmp, current);
    await this._journal({ state: 'activated-pending-self-test', version, current, backup: hadCurrent ? backup : null, sha256: stagedDigest });
    await this.launchApp({ executable: current, selfTest: true });

    let healthy = false;
    const deadline = this.now() + selfTestTimeoutMs;
    do {
      healthy = await this.healthCheck({ version, executable: current });
      if (healthy) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    } while (this.now() < deadline);

    if (!healthy) {
      await this.stopApp();
      if (hadCurrent && await exists(backup)) {
        const rollbackTmp = `${current}.rollback`;
        await fsp.copyFile(backup, rollbackTmp);
        await fsp.rename(rollbackTmp, current);
      } else {
        await fsp.rm(current, { force: true });
      }
      await this._journal({ state: 'rolled-back-self-test-failure', version, restoredPrevious: hadCurrent });
      throw new Error('installed-app self-test failed; rollback completed');
    }

    await this._journal({ state: 'installed-verified', version, current, sha256: stagedDigest });
    return { current, version, sha256: stagedDigest, verified: true };
  }

  async uninstall({ keepUserData = true } = {}) {
    await this.stopApp();
    await fsp.rm(this.paths.app, { recursive: true, force: true });
    await fsp.rm(this.paths.staging, { recursive: true, force: true });
    if (!keepUserData) {
      await fsp.rm(path.join(this.rootDir, 'data'), { recursive: true, force: true });
      await fsp.rm(path.join(this.rootDir, 'models'), { recursive: true, force: true });
    }
    await this._journal({ state: 'uninstalled', keepUserData: !!keepUserData });
    return { uninstalled: true, keepUserData: !!keepUserData };
  }

  async _journal(value) {
    const tmp = `${this.paths.journal}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify({ ...value, at: new Date().toISOString() }, null, 2));
    await fsp.rename(tmp, this.paths.journal);
  }
}

class CrashLoopWatchdog {
  constructor({ stateFile, windowMs = 120000, maxCrashes = 3, cooldownMs = 300000, now = () => Date.now() } = {}) {
    if (!stateFile) throw new Error('stateFile is required');
    this.stateFile = stateFile;
    this.windowMs = windowMs;
    this.maxCrashes = maxCrashes;
    this.cooldownMs = cooldownMs;
    this.now = now;
  }

  async recordExit({ code, signal = null, planned = false } = {}) {
    const state = await this._read();
    const now = this.now();
    if (planned || code === 0) {
      state.crashes = [];
      state.safeModeUntil = 0;
      await this._write(state);
      return { action: 'none', state };
    }
    state.crashes = (state.crashes || []).filter(ts => now - ts <= this.windowMs);
    state.crashes.push(now);
    let action = 'restart';
    if (state.crashes.length >= this.maxCrashes) {
      state.safeModeUntil = now + this.cooldownMs;
      action = 'safe-mode';
    }
    await this._write(state);
    return { action, state, signal };
  }

  async launchProfile() {
    const state = await this._read();
    if ((state.safeModeUntil || 0) > this.now()) {
      return {
        mode: 'safe',
        disableVision: true,
        disableBackgroundMissions: true,
        disableAutoModelLoad: true,
        inferenceConcurrency: 1,
        reason: 'crash-loop',
      };
    }
    return { mode: 'normal' };
  }

  async markStable() {
    const state = await this._read();
    state.crashes = [];
    state.safeModeUntil = 0;
    state.lastStableAt = this.now();
    await this._write(state);
    return state;
  }

  async _read() {
    try { return { crashes: [], safeModeUntil: 0, ...JSON.parse(await fsp.readFile(this.stateFile, 'utf8')) }; }
    catch { return { crashes: [], safeModeUntil: 0 }; }
  }

  async _write(state) {
    await fsp.mkdir(path.dirname(this.stateFile), { recursive: true });
    const tmp = `${this.stateFile}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(state, null, 2));
    await fsp.rename(tmp, this.stateFile);
  }
}

module.exports = { WindowsInstallLifecycle, CrashLoopWatchdog, sha256File };
