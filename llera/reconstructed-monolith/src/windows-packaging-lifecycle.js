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
      quarantine: path.join(this.rootDir, 'repair-quarantine'),
      journal: path.join(this.rootDir, 'install-journal.json'),
    };
  }

  async init() {
    await Promise.all([
      fsp.mkdir(this.paths.app, { recursive: true }),
      fsp.mkdir(this.paths.backup, { recursive: true }),
      fsp.mkdir(this.paths.staging, { recursive: true }),
      fsp.mkdir(this.paths.quarantine, { recursive: true }),
    ]);
  }

  async recoverInterruptedInstall() {
    await this.init();
    const journal = await this._readJournal();
    if (!journal) {
      await this._cleanupTemps();
      return { recovered: false, reason: 'no-journal' };
    }

    const current = path.join(this.paths.app, 'LLera.exe');
    const backup = path.join(this.paths.backup, 'LLera.previous.exe');

    if (String(journal.state).startsWith('repair-required-')) {
      return {
        recovered: false,
        blocked: true,
        repairRequired: true,
        reason: journal.state,
        quarantinedCurrent: journal.quarantinedCurrent || null
      };
    }

    if (journal.state === 'activation-replacing') {
      await this.stopApp();
      if (journal.hadCurrent !== false) {
        const restored = await this._restorePreviousExecutable({
          current,
          backup,
          expectedSha256: journal.previousSha256 || null,
          journal,
          repairReason: 'interrupted-activation'
        });
        if (!restored.ok) {
          if (String(restored.result && restored.result.reason || '').startsWith('rollback-integrity:')) {
            throw new Error('rollback backup integrity mismatch during interrupted-install recovery');
          }
          return restored.result;
        }
      } else {
        await fsp.rm(current, { force: true });
        await fsp.rm(`${current}.activation-old`, { force: true });
      }

      await this._cleanupTemps({ preserveActivationOld: false });
      await this._journal({
        state: 'rolled-back-interrupted-activation',
        version: journal.version || null,
        restoredPrevious: journal.hadCurrent !== false,
        previousSha256: journal.previousSha256 || null
      });
      return {
        recovered: true,
        action: 'rollback-activation',
        restoredPrevious: journal.hadCurrent !== false
      };
    }

    if (journal.state === 'activated-pending-self-test') {
      await this.stopApp();

      if (journal.hadCurrent !== false) {
        const restored = await this._restorePreviousExecutable({
          current,
          backup,
          expectedSha256: journal.previousSha256 || null,
          journal,
          repairReason: 'interrupted-self-test'
        });
        if (!restored.ok) {
          if (String(restored.result && restored.result.reason || '').startsWith('rollback-integrity:')) {
            throw new Error('rollback backup integrity mismatch during interrupted-install recovery');
          }
          return restored.result;
        }
      } else {
        await fsp.rm(current, { force: true });
        await fsp.rm(`${current}.activation-old`, { force: true });
      }

      await this._cleanupTemps({ preserveActivationOld: false });
      await this._journal({
        state: 'rolled-back-interrupted-install',
        version: journal.version || null,
        restoredPrevious: journal.hadCurrent !== false,
        previousSha256: journal.previousSha256 || null
      });
      return {
        recovered: true,
        action: 'rollback',
        restoredPrevious: journal.hadCurrent !== false
      };
    }

    if (journal.state === 'staged') {
      await this._cleanupTemps({ preserveActivationOld: false });
      const preservedCurrent = await exists(current);
      await this._journal({
        state: 'abandoned-staged-install',
        version: journal.version || null,
        preservedCurrent
      });
      return { recovered: true, action: 'discard-staged', preservedCurrent };
    }

    await this._cleanupTemps({ preserveActivationOld: false });
    return { recovered: false, reason: 'journal-terminal', state: journal.state };
  }

  async install({ payloadPath, expectedSha256, version, selfTestTimeoutMs = 5000 }) {
    await this.init();
    const recovery = await this.recoverInterruptedInstall();
    if (recovery && recovery.repairRequired) {
      throw new Error(`install blocked: repair required (${recovery.reason})`);
    }

    if (!/^[a-f0-9]{64}$/i.test(expectedSha256 || '')) throw new Error('expectedSha256 invalid');
    if (!version) throw new Error('version required');
    if (!await exists(payloadPath)) throw new Error('payload missing');

    const actual = await sha256File(payloadPath);
    if (actual.toLowerCase() !== expectedSha256.toLowerCase()) throw new Error('payload integrity mismatch');

    const current = path.join(this.paths.app, 'LLera.exe');
    const backup = path.join(this.paths.backup, 'LLera.previous.exe');
    const staged = path.join(this.paths.staging, `LLera-${sanitizeVersion(version)}.exe`);
    const hadCurrent = await exists(current);
    let previousSha256 = null;

    if (hadCurrent) {
      await this.stopApp();
      previousSha256 = await sha256File(current);
      await fsp.copyFile(current, backup);
      const backupDigest = await sha256File(backup);
      if (backupDigest !== previousSha256) throw new Error('rollback backup integrity mismatch');
    }

    await fsp.copyFile(payloadPath, staged);
    const stagedDigest = await sha256File(staged);
    if (stagedDigest !== actual) throw new Error('staging integrity mismatch');

    await this._journal({
      state: 'staged',
      version,
      stagedSha256: stagedDigest,
      hadCurrent,
      previousSha256
    });

    await this._activateExecutable({
      staged,
      current,
      version,
      stagedSha256: stagedDigest,
      hadCurrent,
      previousSha256
    });

    await this._journal({
      state: 'activated-pending-self-test',
      version,
      hadCurrent,
      sha256: stagedDigest,
      previousSha256
    });

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
      if (hadCurrent) {
        const restored = await this._restorePreviousExecutable({
          current,
          backup,
          expectedSha256: previousSha256,
          journal: { version, sha256: stagedDigest, previousSha256, hadCurrent },
          repairReason: 'self-test-failure'
        });
        if (!restored.ok) {
          throw new Error(`installed-app self-test failed; ${restored.result.reason}; repair required`);
        }
      } else {
        await fsp.rm(current, { force: true });
        await fsp.rm(`${current}.activation-old`, { force: true });
      }

      await this._cleanupTemps({ preserveActivationOld: false });
      await this._journal({
        state: 'rolled-back-self-test-failure',
        version,
        restoredPrevious: hadCurrent,
        previousSha256
      });
      throw new Error('installed-app self-test failed; rollback completed');
    }

    const activatedDigest = await sha256File(current);
    if (activatedDigest !== stagedDigest) {
      throw new Error('activated executable integrity changed before verification commit');
    }

    await this._cleanupTemps({ preserveActivationOld: false });
    await this._journal({
      state: 'installed-verified',
      version,
      sha256: stagedDigest,
      previousSha256
    });
    return { current, version, sha256: stagedDigest, verified: true };
  }

  async _activateExecutable({ staged, current, version, stagedSha256, hadCurrent, previousSha256 }) {
    const tmp = `${current}.new`;
    const displaced = `${current}.activation-old`;

    await fsp.rm(tmp, { force: true });
    await fsp.rm(displaced, { force: true });
    await fsp.copyFile(staged, tmp);

    const tmpDigest = await sha256File(tmp);
    if (tmpDigest !== stagedSha256) throw new Error('activation temp integrity mismatch');

    await this._journal({
      state: 'activation-replacing',
      version,
      hadCurrent,
      sha256: stagedSha256,
      previousSha256
    });

    if (hadCurrent) {
      await fsp.rename(current, displaced);
      if (previousSha256) {
        const displacedDigest = await sha256File(displaced);
        if (displacedDigest !== previousSha256) {
          if (!await exists(current)) {
            try { await fsp.rename(displaced, current); } catch (_) {}
          }
          throw new Error('activation displaced executable integrity mismatch');
        }
      }
    }

    try {
      await fsp.rename(tmp, current);
    } catch (error) {
      if (hadCurrent && await exists(displaced) && !await exists(current)) {
        try { await fsp.rename(displaced, current); } catch (_) {}
      }
      throw error;
    }

    const currentDigest = await sha256File(current);
    if (currentDigest !== stagedSha256) {
      if (hadCurrent && await exists(displaced)) {
        await fsp.rm(current, { force: true });
        await fsp.rename(displaced, current);
      } else {
        await fsp.rm(current, { force: true });
      }
      throw new Error('activated executable integrity mismatch');
    }
  }

  async _restorePreviousExecutable({ current, backup, expectedSha256, journal, repairReason }) {
    const displaced = `${current}.activation-old`;
    let source = null;

    if (await exists(displaced)) source = displaced;
    else if (await exists(backup)) source = backup;

    if (!source) {
      const quarantine = await this._quarantineUnverifiedCurrent(current, journal);
      await this._journal({
        state: 'repair-required-missing-rollback',
        version: journal && journal.version || null,
        hadCurrent: true,
        previousSha256: expectedSha256 || null,
        quarantinedCurrent: quarantine
      });
      return {
        ok: false,
        result: {
          recovered: false,
          blocked: true,
          repairRequired: true,
          reason: `rollback-backup-missing:${repairReason}`,
          quarantinedCurrent: quarantine
        }
      };
    }

    const sourceDigest = await sha256File(source);
    if (expectedSha256 && sourceDigest.toLowerCase() !== String(expectedSha256).toLowerCase()) {
      const quarantine = await this._quarantineUnverifiedCurrent(current, journal);
      await this._journal({
        state: 'repair-required-rollback-integrity',
        version: journal && journal.version || null,
        hadCurrent: true,
        previousSha256: expectedSha256,
        quarantinedCurrent: quarantine
      });
      return {
        ok: false,
        result: {
          recovered: false,
          blocked: true,
          repairRequired: true,
          reason: `rollback-integrity:${repairReason}`,
          quarantinedCurrent: quarantine
        }
      };
    }

    await fsp.rm(current, { force: true });

    if (source === displaced) {
      await fsp.rename(displaced, current);
    } else {
      const rollbackTmp = `${current}.rollback`;
      await fsp.rm(rollbackTmp, { force: true });
      await fsp.copyFile(source, rollbackTmp);
      const tmpDigest = await sha256File(rollbackTmp);
      if (tmpDigest !== sourceDigest) {
        await fsp.rm(rollbackTmp, { force: true });
        throw new Error('rollback temp integrity mismatch');
      }
      await fsp.rename(rollbackTmp, current);
    }

    const restoredDigest = await sha256File(current);
    if (restoredDigest !== sourceDigest) throw new Error('restored executable integrity mismatch');
    return { ok: true, sha256: restoredDigest };
  }

  async uninstall({ keepUserData = true } = {}) {
    await this.stopApp();
    await fsp.rm(this.paths.app, { recursive: true, force: true });
    await fsp.rm(this.paths.staging, { recursive: true, force: true });
    await fsp.rm(this.paths.backup, { recursive: true, force: true });
    await fsp.rm(this.paths.quarantine, { recursive: true, force: true });
    if (!keepUserData) {
      await fsp.rm(path.join(this.rootDir, 'data'), { recursive: true, force: true });
      await fsp.rm(path.join(this.rootDir, 'models'), { recursive: true, force: true });
    }
    await this._journal({ state: 'uninstalled', keepUserData: !!keepUserData });
    return { uninstalled: true, keepUserData: !!keepUserData };
  }

  async _quarantineUnverifiedCurrent(current, journal) {
    if (!await exists(current)) return null;
    const digest = await sha256File(current);
    const safeVersion = sanitizeVersion(journal && journal.version || 'unknown');
    const name = `LLera-${safeVersion}-${digest.slice(0, 16)}.unverified.exe`;
    const target = path.join(this.paths.quarantine, name);
    await fsp.copyFile(current, target);
    const copied = await sha256File(target);
    if (copied !== digest) throw new Error('repair quarantine integrity mismatch');
    return { path: target, sha256: digest };
  }

  async _cleanupTemps({ preserveActivationOld = false } = {}) {
    const current = path.join(this.paths.app, 'LLera.exe');
    const targets = [
      fsp.rm(`${current}.new`, { force: true }),
      fsp.rm(`${current}.rollback`, { force: true }),
      fsp.rm(`${this.paths.journal}.tmp`, { force: true }),
    ];
    if (!preserveActivationOld) targets.push(fsp.rm(`${current}.activation-old`, { force: true }));
    await Promise.all(targets);
  }

  async _readJournal() {
    if (!await exists(this.paths.journal)) return null;
    let parsed;
    try {
      parsed = JSON.parse(await fsp.readFile(this.paths.journal, 'utf8'));
    } catch {
      throw new Error('install journal corrupt; refusing unsafe install/recovery');
    }
    if (!parsed || typeof parsed !== 'object' || typeof parsed.state !== 'string') {
      throw new Error('install journal invalid; refusing unsafe install/recovery');
    }
    return parsed;
  }

  async _journal(value) {
    await fsp.mkdir(path.dirname(this.paths.journal), { recursive: true });
    const tmp = `${this.paths.journal}.tmp`;
    await fsp.writeFile(
      tmp,
      JSON.stringify({ ...value, at: new Date(this.now()).toISOString() }, null, 2),
      'utf8'
    );
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

    state.crashes = (state.crashes || []).filter(ts => now - ts <= this.windowMs);

    if (planned || code === 0) {
      state.lastCleanExitAt = now;
      state.lastExitPlanned = Boolean(planned);
      await this._write(state);
      return { action: 'none', state };
    }

    state.crashes.push(now);
    let action = 'restart';
    if (state.crashes.length >= this.maxCrashes) {
      state.safeModeUntil = Math.max(Number(state.safeModeUntil || 0), now + this.cooldownMs);
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
        reason: state.stateCorrupt ? 'watchdog-state-corrupt' : 'crash-loop',
      };
    }
    return { mode: 'normal' };
  }

  async markStable() {
    const state = await this._read();
    state.crashes = [];
    state.safeModeUntil = 0;
    state.stateCorrupt = false;
    state.lastStableAt = this.now();
    await this._write(state);
    return state;
  }

  async _read() {
    let raw;
    try {
      raw = await fsp.readFile(this.stateFile, 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') return { crashes: [], safeModeUntil: 0, stateCorrupt: false };
      return this._corruptState();
    }

    try {
      const parsed = JSON.parse(raw);
      const crashesValid = Array.isArray(parsed.crashes) && parsed.crashes.every(Number.isFinite);
      const safeModeValid = Number.isFinite(Number(parsed.safeModeUntil || 0));
      if (!parsed || typeof parsed !== 'object' || !crashesValid || !safeModeValid) return this._corruptState();
      return {
        ...parsed,
        crashes: parsed.crashes.map(Number),
        safeModeUntil: Number(parsed.safeModeUntil || 0),
        stateCorrupt: Boolean(parsed.stateCorrupt),
      };
    } catch {
      return this._corruptState();
    }
  }

  _corruptState() {
    const now = this.now();
    return {
      crashes: [],
      safeModeUntil: now + this.cooldownMs,
      stateCorrupt: true,
      corruptionDetectedAt: now,
    };
  }

  async _write(state) {
    await fsp.mkdir(path.dirname(this.stateFile), { recursive: true });
    const tmp = `${this.stateFile}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(state, null, 2));
    await fsp.rename(tmp, this.stateFile);
  }
}

function sanitizeVersion(value) {
  const safe = String(value || '').replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!safe || safe === '.' || safe === '..') throw new Error('version invalid');
  return safe;
}

module.exports = {
  WindowsInstallLifecycle,
  CrashLoopWatchdog,
  sha256File,
  sanitizeVersion
};
