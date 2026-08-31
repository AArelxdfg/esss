'use strict';

class RuntimeLifecycle {
  constructor({ start, stop, health, isAlive = null, stopTimeoutMs = 15000, now = () => Date.now() } = {}) {
    if (typeof start !== 'function' || typeof stop !== 'function' || typeof health !== 'function') {
      throw new Error('start/stop/health functions are required');
    }
    if (isAlive !== null && typeof isAlive !== 'function') throw new Error('isAlive must be a function when provided');
    if (!Number.isFinite(stopTimeoutMs) || stopTimeoutMs <= 0) throw new Error('stopTimeoutMs must be a positive number');
    this.startBackend = start;
    this.stopBackend = stop;
    this.healthBackend = health;
    this.isAliveBackend = isAlive;
    this.stopTimeoutMs = stopTimeoutMs;
    this.now = now;
    this.state = 'stopped';
    this.model = null;
    this.desiredModel = null;
    this.pid = null;
    this.generation = 0;
    this.activeInference = new Map();
    this.lastError = null;
    this.lastSwitchFailure = null;
    this.lastBackendExit = null;
    this.recoveryCount = 0;
    this.switchRollbackCount = 0;
    this.transitionLog = [];
    this.lifecycleSequence = 0;
    this.lifecycleOperation = null;
    this.lifecycleQueue = Promise.resolve();
  }

  snapshot() {
    return {
      state: this.state,
      model: this.model,
      desiredModel: this.desiredModel,
      pid: this.pid,
      generation: this.generation,
      activeInference: [...this.activeInference.values()].map(x => ({ id: x.id, priority: x.priority, startedAt: x.startedAt, generation: x.generation })),
      lifecycleOperation: this.lifecycleOperation ? { ...this.lifecycleOperation } : null,
      lastError: this.lastError,
      lastSwitchFailure: this.lastSwitchFailure,
      lastBackendExit: this.lastBackendExit ? { ...this.lastBackendExit } : null,
      recoveryCount: this.recoveryCount,
      switchRollbackCount: this.switchRollbackCount
    };
  }

  _runLifecycle(type, operation) {
    const owner = `${type}:${++this.lifecycleSequence}`;
    const scheduled = this.lifecycleQueue.then(async () => {
      if (this.lifecycleOperation) {
        const error = new Error(`runtime lifecycle owner collision: ${this.lifecycleOperation.owner}`);
        error.code = 'RUNTIME_LIFECYCLE_OWNER_COLLISION';
        throw error;
      }
      this.lifecycleOperation = { owner, type, startedAt: this.now() };
      try {
        return await operation(owner);
      } finally {
        if (this.lifecycleOperation?.owner === owner) this.lifecycleOperation = null;
      }
    });
    this.lifecycleQueue = scheduled.then(() => undefined, () => undefined);
    return scheduled;
  }

  _assertTransitionOwner(owner) {
    if (!owner || this.lifecycleOperation?.owner !== owner) {
      const error = new Error('runtime transition requires the active lifecycle owner');
      error.code = 'RUNTIME_TRANSITION_OWNER_REQUIRED';
      throw error;
    }
  }

  _transition(next, reason, owner) {
    this._assertTransitionOwner(owner);
    const allowed = {
      stopped: new Set(['starting']),
      starting: new Set(['ready', 'failed', 'stopping']),
      ready: new Set(['stopping', 'recovering', 'failed']),
      stopping: new Set(['stopped', 'failed']),
      recovering: new Set(['starting', 'failed']),
      failed: new Set(['recovering', 'starting', 'stopping'])
    };
    if (!allowed[this.state]?.has(next)) throw new Error(`illegal runtime transition ${this.state} -> ${next}`);
    this.transitionLog.push({ from: this.state, to: next, reason, owner, at: this.now() });
    this.state = next;
  }

  async _probeAlive({ pid, model, reason = 'pid-probe' }) {
    if (!pid || !this.isAliveBackend) return null;
    try {
      return Boolean(await this.isAliveBackend({ pid, model, reason }));
    } catch (err) {
      const error = new Error(`runtime pid probe failed for ${pid}: ${String(err?.message || err)}`);
      error.code = 'RUNTIME_PID_PROBE_FAILED';
      error.pid = pid;
      throw error;
    }
  }

  _recordBackendExit({ pid, model, kind, reason }) {
    this.lastBackendExit = { pid, model, kind, reason, at: this.now() };
    return this.lastBackendExit;
  }

  async _stopBackendBounded({ pid, model, reason }) {
    if (!pid) return { attempted:false, stopped:true, alreadyDead:false };

    const aliveBefore = await this._probeAlive({ pid, model, reason:`pre-stop:${reason}` });
    if (aliveBefore === false) {
      this._recordBackendExit({ pid, model, kind:'external-dead', reason });
      return { attempted:false, stopped:true, alreadyDead:true };
    }

    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`runtime stop timed out for pid ${pid} after ${this.stopTimeoutMs}ms`);
        error.code = 'RUNTIME_STOP_TIMEOUT';
        error.pid = pid;
        reject(error);
      }, this.stopTimeoutMs);
    });

    try {
      await Promise.race([
        Promise.resolve().then(() => this.stopBackend({ pid, model, reason })),
        timeout
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }

    const aliveAfter = await this._probeAlive({ pid, model, reason:`post-stop:${reason}` });
    if (aliveAfter === true) {
      const error = new Error(`runtime stop returned but pid ${pid} is still alive`);
      error.code = 'RUNTIME_STOP_DID_NOT_TERMINATE';
      error.pid = pid;
      throw error;
    }

    this._recordBackendExit({ pid, model, kind:'stopped', reason });
    return { attempted:true, stopped:true, alreadyDead:false };
  }

  async _cleanupStartedBackend({ pid, model, reason }) {
    if (!pid) return { attempted: false, stopped: false, alreadyDead:false, error: null, code:null };
    try {
      const result = await this._stopBackendBounded({ pid, model, reason });
      return { ...result, error:null, code:null };
    } catch (err) {
      return {
        attempted: true,
        stopped: false,
        alreadyDead:false,
        error: String(err?.message || err),
        code: err && err.code || null
      };
    }
  }

  async _rollbackFailedSwitch({ previousModel, failedModel, originalError, owner }) {
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
      const restored = await this._ensureRunning(previousModel, `model-switch-rollback:${failedModel}->${previousModel}`, owner);
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

  async _reconcileTrackedPid(reason) {
    if (!this.pid || !this.isAliveBackend) return { reconciled:false, alive:null };
    const pid = this.pid;
    const model = this.model;
    const alive = await this._probeAlive({ pid, model, reason });
    if (alive !== false) return { reconciled:false, alive };
    this._recordBackendExit({ pid, model, kind:'external-dead', reason });
    this.pid = null;
    this.model = null;
    this.activeInference.clear();
    return { reconciled:true, alive:false, pid, model };
  }

  async ensureRunning(model, reason = 'ensure') {
    return this._runLifecycle('ensure-running', owner => this._ensureRunning(model, reason, owner));
  }

  async _ensureRunning(model, reason, owner) {
    if (!model) throw new Error('model is required');

    this.desiredModel = model;
    if (this.state === 'ready' && this.model === model) {
      const reconciled = await this._reconcileTrackedPid('ensure-ready-probe');
      if (!reconciled.reconciled) return this.snapshot();
      this._transition('failed', 'external-kill-detected', owner);
    }

    const previousModel = this.state === 'ready' && this.model !== model ? this.model : null;
    if (previousModel) {
      await this.drainActiveInference(`model-switch:${previousModel}->${model}`);
      await this._stop(`model-switch:${previousModel}->${model}`, { preserveDesiredModel: true }, owner);
    }
    if (this.state === 'starting') throw new Error('runtime start already in progress');
    if (this.state === 'stopping') throw new Error('runtime stop in progress');
    if (this.state === 'failed' && this.pid) {
      const reconciled = await this._reconcileTrackedPid('failed-state-pid-reconcile');
      if (!reconciled.reconciled) {
        const error = new Error(`runtime start blocked: unresolved backend pid ${this.pid}`);
        error.code = 'RUNTIME_ORPHAN_UNRESOLVED';
        throw error;
      }
    }
    if (this.state === 'failed') this._transition('recovering', reason, owner);
    if (this.state === 'recovering') this._transition('starting', reason, owner);
    else if (this.state === 'stopped') this._transition('starting', reason, owner);

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
      this._transition('ready', reason, owner);
      return this.snapshot();
    } catch (err) {
      const cleanupPid = started && started.pid ? started.pid : this.pid;
      const cleanup = await this._cleanupStartedBackend({
        pid: cleanupPid,
        model,
        reason: 'failed-start-cleanup'
      });
      const baseError = String(err?.message || err);
      this.lastError = cleanup.error ? `${baseError}; cleanup failed: ${cleanup.error}` : baseError;

      if (cleanup.error && cleanupPid) {
        this.pid = cleanupPid;
        this.model = model;
      } else {
        this.pid = null;
        this.model = null;
        this.activeInference.clear();
      }
      this._transition('failed', cleanup.error ? 'start-failed-cleanup-failed' : 'start-failed-cleaned', owner);

      if (previousModel && !cleanup.error) {
        try {
          await this._rollbackFailedSwitch({ previousModel, failedModel: model, originalError: err, owner });
        } catch (_) {
          // Preserve the original switch failure for the caller while state records rollback failure.
        }
      }
      throw err;
    }
  }

  async stop(reason = 'stop', { preserveDesiredModel = false } = {}) {
    return this._runLifecycle('stop', owner => this._stop(reason, { preserveDesiredModel }, owner));
  }

  async _stop(reason, { preserveDesiredModel = false } = {}, owner) {
    if (this.state === 'stopped') return this.snapshot();
    if (!['ready', 'failed', 'starting'].includes(this.state)) throw new Error(`cannot stop from ${this.state}`);

    try {
      await this.drainActiveInference(`stop-drain:${reason}`);
    } catch (err) {
      this.lastError = `stop inference drain failed: ${String(err?.message || err)}`;
      throw err;
    }

    this._transition('stopping', reason, owner);
    try {
      if (this.pid) await this._stopBackendBounded({ pid:this.pid, model:this.model, reason });
      this.pid = null;
      this.model = null;
      this.activeInference.clear();
      if (!preserveDesiredModel) this.desiredModel = null;
      this._transition('stopped', reason, owner);
      return this.snapshot();
    } catch (err) {
      this.lastError = String(err?.message || err);
      this._transition('failed', 'stop-failed', owner);
      throw err;
    }
  }

  registerInference(id, { priority = 'normal', abort } = {}) {
    if (this.lifecycleOperation) throw new Error('runtime lifecycle transition in progress');
    if (this.state !== 'ready') throw new Error('runtime is not ready');
    if (!id || this.activeInference.has(id)) throw new Error('unique inference id required');
    if (typeof abort !== 'function') throw new Error('abort callback required');
    const task = { id, priority, abort, startedAt: this.now(), generation: this.generation };
    this.activeInference.set(id, task);
    return task;
  }

  completeInference(id, generation) {
    const task = this.activeInference.get(id);
    if (!task || !Number.isSafeInteger(generation) || generation !== task.generation) return false;
    return this.activeInference.delete(id);
  }

  async applyHostPressure(level) {
    const normalized = String(level || '').toUpperCase();
    if (normalized !== 'CRITICAL') return { level: normalized, aborted: [], failures: [] };
    if (this.lifecycleOperation) {
      return {
        level: normalized,
        aborted: [],
        failures: [],
        deferred: true,
        reason: 'lifecycle-transition-in-progress'
      };
    }

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
    return this._runLifecycle('recover', owner => this._recover(reason, owner));
  }

  async _recover(reason, owner) {
    if (!['ready', 'failed'].includes(this.state)) throw new Error(`cannot recover from ${this.state}`);
    const desiredModel = this.desiredModel || this.model;
    if (!desiredModel) throw new Error('no desired model to recover');

    try {
      await this.drainActiveInference(`recovery-drain:${reason}`);
    } catch (err) {
      this.lastError = `recovery inference drain failed: ${String(err?.message || err)}`;
      throw err;
    }

    this._transition('recovering', reason, owner);
    if (this.pid) {
      try {
        await this._stopBackendBounded({ pid:this.pid, model:this.model, reason:`recovery-stop:${reason}` });
      } catch (err) {
        this.lastError = `recovery stop failed: ${String(err?.message || err)}`;
        this._transition('failed', 'recovery-stop-failed', owner);
        throw err;
      }
    }
    this.pid = null;
    this.model = null;
    this.activeInference.clear();
    this.recoveryCount += 1;
    return this._ensureRunning(desiredModel, `recovery:${reason}`, owner);
  }
}

module.exports = { RuntimeLifecycle };
