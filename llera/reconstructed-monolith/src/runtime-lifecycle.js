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
    this.recoveryCount = 0;
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
      recoveryCount: this.recoveryCount
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

  async ensureRunning(model, reason = 'ensure') {
    if (!model) throw new Error('model is required');
    this.desiredModel = model;
    if (this.state === 'ready' && this.model === model) return this.snapshot();

    if (this.state === 'ready' && this.model !== model) await this.stop(`model-switch:${this.model}->${model}`, { preserveDesiredModel: true });
    if (this.state === 'starting') throw new Error('runtime start already in progress');
    if (this.state === 'stopping') throw new Error('runtime stop in progress');
    if (this.state === 'failed') this._transition('recovering', reason);
    if (this.state === 'recovering') this._transition('starting', reason);
    else if (this.state === 'stopped') this._transition('starting', reason);

    try {
      const result = await this.startBackend({ model, generation: this.generation + 1 });
      if (!result || !result.pid) throw new Error('runtime start returned no pid');
      this.pid = result.pid;
      this.model = model;
      this.generation += 1;
      const ok = await this.healthBackend({ pid: this.pid, model: this.model });
      if (!ok) throw new Error('runtime health check failed');
      this.lastError = null;
      this._transition('ready', reason);
      return this.snapshot();
    } catch (err) {
      this.lastError = String(err?.message || err);
      this.pid = null;
      this.model = null;
      this._transition('failed', 'start-failed');
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

  completeInference(id) {
    return this.activeInference.delete(id);
  }

  async applyHostPressure(level) {
    const normalized = String(level || '').toUpperCase();
    if (normalized !== 'CRITICAL') return { level: normalized, aborted: [] };
    const victims = [...this.activeInference.values()]
      .filter(t => t.priority === 'low')
      .sort((a, b) => a.startedAt - b.startedAt);
    const aborted = [];
    for (const task of victims) {
      await task.abort('host-pressure-critical');
      this.activeInference.delete(task.id);
      aborted.push(task.id);
    }
    return { level: normalized, aborted };
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
