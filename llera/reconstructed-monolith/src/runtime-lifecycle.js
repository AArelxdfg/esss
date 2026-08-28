'use strict';

class RuntimeLifecycle {
  constructor({ start, stop, health, now = () => Date.now() } = {}) {
    if (typeof start !== 'function' || typeof stop !== 'function' || typeof health !== 'function') {
      throw new Error('start/stop/health functions are required');
    }
    this.startBackend = start;
    this.stopBackend = stop;
    this.healthBackend = health;
    this.now = now;
    this.state = 'stopped';
    this.model = null;
    this.desiredModel = null;
    this.pid = null;
    this.generation = 0;
    this.activeInference = new Map();
    this.lastError = null;
    this.lastSwitchFailure = null;
    this.recoveryCount = 0;
    this.switchRollbackCount = 0;
    this.transitionLog = [];
  }

  snapshot() {
    return {
      state: this.state,
      model: this.model,
      desiredModel: this.desiredModel,
      pid: this.pid,
      generation: this.generation,
      activeInference: [...this.activeInference.values()].map(x => ({ id: x.id, priority: x.priority, startedAt: x.startedAt })),
      lastError: this.lastError,
      lastSwitchFailure: this.lastSwitchFailure,
      recoveryCount: this.recoveryCount,
      switchRollbackCount: this.switchRollbackCount
    };
  }

  _transition(next, reason) {
    const allowed = {
      stopped: new Set(['starting']),
      starting: new Set(['ready', 'failed', 'stopping']),
      ready: new Set(['stopping', 'recovering', 'failed']),
      stopping: new Set(['stopped', 'failed']),
      recovering: new Set(['starting', 'failed']),
      failed: new Set(['recovering', 'starting', 'stopping'])
    };
    if (!allowed[this.state]?.has(next)) throw new Error(`illegal runtime transition ${this.state} -> ${next}`);
    this.transitionLog.push({ from: this.state, to: next, reason, at: this.now() });
    this.state = next;
  }

  async _cleanupStartedBackend({ pid, model, reason }) {
    if (!pid) return { attempted: false, stopped: false, error: null };
    try {
      await this.stopBackend({ pid, model, reason });
      return { attempted: true, stopped: true, error: null };
    } catch (err) {
      return { attempted: true, stopped: false, error: String(err?.message || err) };
    }
  }

  async _rollbackFailedSwitch({ previousModel, failedModel, originalError }) {
    const switchFailure = String(originalError?.message || originalError);
    this.lastSwitchFailure = {
      from: previousModel,
      to: failedModel,
      error: switchFailure,
      at: this.now(),
      restored: false
    };

    try {
      this.desiredModel = previousModel;
      const restored = await this.ensureRunning(previousModel, `model-switch-rollback:${failedModel}->${previousModel}`);
      this.desiredModel = failedModel;
      this.switchRollbackCount += 1;
      this.lastSwitchFailure = {
        ...this.lastSwitchFailure,
        restored: true,
        restoredGeneration: restored.generation
      };
      this.lastError = switchFailure;
      return restored;
    } catch (rollbackError) {
      this.desiredModel = failedModel;
      const rollbackMessage = String(rollbackError?.message || rollbackError);
      this.lastSwitchFailure = {
        ...this.lastSwitchFailure,
        restored: false,
        rollbackError: rollbackMessage
      };
      this.lastError = `${switchFailure}; rollback failed: ${rollbackMessage}`;
      throw rollbackError;
    }
  }

  async drainActiveInference(reason = 'runtime-drain') {
    const tasks = [...this.activeInference.values()]
      .sort((a, b) => a.startedAt - b.startedAt || String(a.id).localeCompare(String(b.id)));
    const drained = [];
    const failures = [];

    for (const task of tasks) {
      try {
        await task.abort(reason);
        this.activeInference.delete(task.id);
        drained.push(task.id);
      } catch (err) {
        failures.push({ id: task.id, error: String(err?.message || err) });
      }
    }

    if (failures.length) {
      const error = new Error(`inference drain failed: ${failures.map(x => x.id).join(', ')}`);
      error.failures = failures;
      error.drained = drained;
      throw error;
    }

    return { reason, drained };
  }

  async ensureRunning(model, reason = 'ensure') {
    if (!model) throw new Error('model is required');

    const previousModel = this.state === 'ready' && this.model !== model ? this.model : null;
    this.desiredModel = model;
    if (this.state === 'ready' && this.model === model) return this.snapshot();

    if (previousModel) {
      await this.drainActiveInference(`model-switch:${previousModel}->${model}`);
      await this.stop(`model-switch:${previousModel}->${model}`, { preserveDesiredModel: true });
    }
    if (this.state === 'starting') throw new Error('runtime start already in progress');
    if (this.state === 'stopping') throw new Error('runtime stop in progress');
    if (this.state === 'failed') this._transition('recovering', reason);
    if (this.state === 'recovering') this._transition('starting', reason);
    else if (this.state === 'stopped') this._transition('starting', reason);

    let started = null;
    try {
      started = await this.startBackend({ model, generation: this.generation + 1 });
      if (!started || !started.pid) throw new Error('runtime start returned no pid');
      this.pid = started.pid;
      this.model = model;

      const ok = await this.healthBackend({ pid: this.pid, model: this.model });
      if (!ok) throw new Error('runtime health check failed');

      this.generation += 1;
      this.lastError = null;
      this._transition('ready', reason);
      return this.snapshot();
    } catch (err) {
      const cleanup = await this._cleanupStartedBackend({
        pid: started && started.pid ? started.pid : this.pid,
        model,
        reason: 'failed-start-cleanup'
      });
      const baseError = String(err?.message || err);
      this.lastError = cleanup.error ? `${baseError}; cleanup failed: ${cleanup.error}` : baseError;
      this.pid = null;
      this.model = null;
      this.activeInference.clear();
      this._transition('failed', cleanup.error ? 'start-failed-cleanup-failed' : 'start-failed-cleaned');

      if (previousModel && !cleanup.error) {
        try {
          await this._rollbackFailedSwitch({ previousModel, failedModel: model, originalError: err });
        } catch (_) {
          // Preserve the original switch failure for the caller while state records rollback failure.
        }
      }
      throw err;
    }
  }

  async stop(reason = 'stop', { preserveDesiredModel = false } = {}) {
    if (this.state === 'stopped') return this.snapshot();
    if (!['ready', 'failed', 'starting'].includes(this.state)) throw new Error(`cannot stop from ${this.state}`);
    this._transition('stopping', reason);
    try {
      if (this.pid) await this.stopBackend({ pid: this.pid, model: this.model });
      this.pid = null;
      this.model = null;
      this.activeInference.clear();
      if (!preserveDesiredModel) this.desiredModel = null;
      this._transition('stopped', reason);
      return this.snapshot();
    } catch (err) {
      this.lastError = String(err?.message || err);
      this._transition('failed', 'stop-failed');
      throw err;
    }
  }

  registerInference(id, { priority = 'normal', abort } = {}) {
    if (this.state !== 'ready') throw new Error('runtime is not ready');
    if (!id || this.activeInference.has(id)) throw new Error('unique inference id required');
    if (typeof abort !== 'function') throw new Error('abort callback required');
    const task = { id, priority, abort, startedAt: this.now(), generation: this.generation };
    this.activeInference.set(id, task);
    return task;
  }

  completeInference(id) { return this.activeInference.delete(id); }

  async applyHostPressure(level) {
    const normalized = String(level || '').toUpperCase();
    if (normalized !== 'CRITICAL') return { level: normalized, aborted: [], failures: [] };

    const victims = [...this.activeInference.values()]
      .filter(t => t.priority === 'low')
      .sort((a, b) => a.startedAt - b.startedAt || String(a.id).localeCompare(String(b.id)));

    const aborted = [];
    const failures = [];

    for (const task of victims) {
      try {
        await task.abort('host-pressure-critical');
        this.activeInference.delete(task.id);
        aborted.push(task.id);
      } catch (err) {
        // A broken abort callback must not prevent later low-priority inference
        // from being preempted. Keep the failed victim registered so the caller
        // can reconcile/retry it explicitly instead of silently losing state.
        failures.push({ id: task.id, error: String(err?.message || err) });
      }
    }

    return {
      level: normalized,
      aborted,
      failures,
      degraded: failures.length > 0
    };
  }

  async recover(reason = 'health-failure') {
    if (!['ready', 'failed'].includes(this.state)) throw new Error(`cannot recover from ${this.state}`);
    const desiredModel = this.desiredModel || this.model;
    if (!desiredModel) throw new Error('no desired model to recover');
    this._transition('recovering', reason);
    if (this.pid) {
      try { await this.stopBackend({ pid: this.pid, model: this.model }); } catch (_) { /* best-effort cleanup */ }
    }
    this.pid = null;
    this.model = null;
    this.activeInference.clear();
    this.recoveryCount += 1;
    return this.ensureRunning(desiredModel, `recovery:${reason}`);
  }
}

module.exports = { RuntimeLifecycle };
