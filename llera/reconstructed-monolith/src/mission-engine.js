'use strict';

const crypto = require('crypto');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableId(prefix, seed) {
  return `${prefix}_${crypto.createHash('sha256').update(String(seed)).digest('hex').slice(0, 16)}`;
}

class MissionEngine {
  constructor({ load, save, now = () => Date.now() } = {}) {
    if (typeof load !== 'function' || typeof save !== 'function') {
      throw new Error('load/save persistence functions are required');
    }
    this.loadBackend = load;
    this.saveBackend = save;
    this.now = now;
    this.state = { schema: 1, missions: {}, order: [] };
    this.loaded = false;
    this.initPromise = null;
    this.persistenceInProgress = false;
    this.mutationQueue = Promise.resolve();
  }

  async init() {
    if (this.loaded) return this.snapshot();
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      const persisted = await this.loadBackend();
      if (persisted) {
        const candidate = this._normalizeAndValidateState(persisted);
        this._repairInterruptedState(candidate);
        await this.saveBackend(clone(candidate));
        this.state = candidate;
      }
      this.loaded = true;
      return this.snapshot();
    })();
    try {
      return await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  snapshot() {
    return clone(this.state);
  }

  getMission(id) {
    const mission = this.state.missions[id];
    return mission ? clone(mission) : null;
  }

  listMissions() {
    return this.state.order.map(id => clone(this.state.missions[id])).filter(Boolean);
  }

  async createMission({ title, goal, mode = 'work', steps = [], budget = {} } = {}) {
    this._requireLoaded();
    return this._mutate(state => {
      if (!title || !goal) throw new Error('title and goal are required');
      if (!['conversation', 'work'].includes(mode)) throw new Error('mode must be conversation or work');
      if (!Array.isArray(steps) || steps.length === 0) throw new Error('at least one mission step is required');

      const createdAt = this.now();
      const id = stableId('mission', `${createdAt}:${title}:${goal}:${state.order.length}`);
      if (state.missions[id]) throw new Error('mission id collision');

      const normalizedSteps = steps.map((step, index) => {
        const name = typeof step === 'string' ? step : step.name;
        if (!name) throw new Error(`step ${index} requires a name`);
        const dependencies = typeof step === 'string' ? [] : (step.dependencies || []);
        if (!Array.isArray(dependencies)) throw new Error(`step ${index} dependencies must be an array`);
        return {
          id: step.id || stableId('step', `${id}:${index}:${name}`),
          name,
          status: 'pending',
          dependencies: [...dependencies],
          attempts: 0,
          startedAt: null,
          completedAt: null,
          lastError: null,
          checkpointId: null
        };
      });

      const ids = new Set(normalizedSteps.map(s => s.id));
      if (ids.size !== normalizedSteps.length) throw new Error('duplicate mission step id');
      for (const step of normalizedSteps) {
        for (const dep of step.dependencies) {
          if (!ids.has(dep)) throw new Error(`unknown dependency ${dep}`);
          if (dep === step.id) throw new Error(`step ${step.id} cannot depend on itself`);
        }
      }
      this._assertAcyclic(normalizedSteps);

      const mission = {
        id,
        title,
        goal,
        mode,
        status: 'pending',
        createdAt,
        updatedAt: createdAt,
        startedAt: null,
        completedAt: null,
        currentStepId: null,
        resumeCount: 0,
        budget: {
          maxSteps: Number.isFinite(budget.maxSteps) ? budget.maxSteps : normalizedSteps.length,
          maxAttemptsPerStep: Number.isFinite(budget.maxAttemptsPerStep) ? budget.maxAttemptsPerStep : 3
        },
        steps: normalizedSteps,
        checkpoints: [],
        toolTrace: []
      };

      if (mission.budget.maxSteps < normalizedSteps.length) throw new Error('budget maxSteps is below mission step count');
      state.missions[id] = mission;
      state.order.unshift(id);
      return mission;
    });
  }

  async startMission(id) {
    this._requireLoaded();
    return this._mutate(state => {
      const mission = this._missionInState(state, id);
      if (!['pending', 'paused', 'interrupted'].includes(mission.status)) {
        throw new Error(`cannot start mission from ${mission.status}`);
      }
      if (!mission.startedAt) mission.startedAt = this.now();
      if (mission.status === 'interrupted') mission.resumeCount += 1;
      mission.status = 'running';
      mission.updatedAt = this.now();
      return mission;
    });
  }

  nextRunnableStep(id) {
    const mission = this._mission(id);
    if (mission.status !== 'running') return null;
    const complete = new Set(mission.steps.filter(s => s.status === 'completed').map(s => s.id));
    const step = mission.steps.find(s =>
      s.status === 'pending' && s.dependencies.every(dep => complete.has(dep))
    );
    return step ? clone(step) : null;
  }

  async beginStep(missionId, stepId) {
    this._requireLoaded();
    return this._mutate(state => {
      const mission = this._missionInState(state, missionId);
      if (mission.status !== 'running') throw new Error('mission is not running');
      if (mission.currentStepId) throw new Error(`mission already has active step ${mission.currentStepId}`);
      const step = this._step(mission, stepId);
      if (step.status !== 'pending') throw new Error(`cannot begin step from ${step.status}`);
      const completed = new Set(mission.steps.filter(s => s.status === 'completed').map(s => s.id));
      if (!step.dependencies.every(dep => completed.has(dep))) throw new Error('step dependencies are not complete');
      if (step.attempts >= mission.budget.maxAttemptsPerStep) throw new Error('step attempt budget exhausted');

      step.status = 'running';
      step.attempts += 1;
      step.startedAt = this.now();
      step.lastError = null;
      mission.currentStepId = step.id;
      mission.updatedAt = this.now();
      return step;
    });
  }

  async appendToolTrace(missionId, entry = {}) {
    this._requireLoaded();
    return this._mutate(state => {
      const mission = this._missionInState(state, missionId);
      if (!entry.tool) throw new Error('tool is required');
      const record = {
        id: stableId('trace', `${mission.id}:${mission.toolTrace.length}:${this.now()}:${entry.tool}`),
        at: this.now(),
        stepId: entry.stepId || mission.currentStepId || null,
        tool: entry.tool,
        argumentsHash: entry.argumentsHash || null,
        semanticFingerprint: entry.semanticFingerprint || null,
        outcome: entry.outcome || 'observed',
        material: Boolean(entry.material),
        verification: Boolean(entry.verification),
        observation: Boolean(entry.observation),
        scope: entry.scope || null,
        verifiesFingerprint: entry.verifiesFingerprint || null,
        evidenceIds: [...(entry.evidenceIds || [])]
      };
      mission.toolTrace.push(record);
      mission.updatedAt = record.at;
      return record;
    });
  }

  async checkpoint(missionId, payload = {}) {
    this._requireLoaded();
    return this._mutate(state => {
      const mission = this._missionInState(state, missionId);
      const checkpoint = this._buildCheckpoint(mission, payload);
      mission.checkpoints.push(checkpoint);
      if (mission.currentStepId) this._step(mission, mission.currentStepId).checkpointId = checkpoint.id;
      mission.updatedAt = checkpoint.at;
      return checkpoint;
    });
  }

  async completeStep(missionId, stepId, result = {}) {
    this._requireLoaded();
    return this._mutate(state => {
      const mission = this._missionInState(state, missionId);
      if (mission.currentStepId !== stepId) throw new Error('step is not the active mission step');
      const step = this._step(mission, stepId);
      if (step.status !== 'running') throw new Error('step is not running');

      // Finalize the step and its durable checkpoint in one candidate state and one save.
      const completedAt = this.now();
      step.status = 'completed';
      step.completedAt = completedAt;
      step.lastError = null;
      mission.currentStepId = null;

      if (mission.steps.every(s => s.status === 'completed')) {
        mission.status = 'completed';
        mission.completedAt = completedAt;
      }

      const checkpoint = this._buildCheckpoint(mission, {
        type: 'step-complete',
        stepId,
        result
      });
      step.checkpointId = checkpoint.id;
      mission.checkpoints.push(checkpoint);
      mission.updatedAt = checkpoint.at;
      return mission;
    });
  }

  async failStep(missionId, stepId, error) {
    this._requireLoaded();
    return this._mutate(state => {
      const mission = this._missionInState(state, missionId);
      if (mission.currentStepId !== stepId) throw new Error('step is not the active mission step');
      const step = this._step(mission, stepId);
      step.status = step.attempts >= mission.budget.maxAttemptsPerStep ? 'failed' : 'pending';
      step.lastError = String(error?.message || error || 'unknown error');
      mission.currentStepId = null;
      mission.status = step.status === 'failed' ? 'failed' : 'running';
      mission.updatedAt = this.now();
      return mission;
    });
  }

  async pauseMission(id, reason = 'user-pause') {
    this._requireLoaded();
    return this._mutate(state => {
      const mission = this._missionInState(state, id);
      if (mission.status !== 'running') throw new Error('only running missions can be paused');
      if (mission.currentStepId) {
        const step = this._step(mission, mission.currentStepId);
        step.status = 'pending';
        step.lastError = `interrupted:${reason}`;
        mission.currentStepId = null;
      }
      mission.status = 'paused';
      mission.updatedAt = this.now();
      return mission;
    });
  }

  _repairInterruptedState(state = this.state) {
    for (const id of state.order) {
      const mission = state.missions[id];
      if (!mission) continue;

      const runningSteps = mission.steps.filter(step => step && step.status === 'running');
      if (mission.status === 'running' || mission.currentStepId || runningSteps.length > 0) {
        // Reconcile every persisted running step, not only currentStepId. Legacy/partial writes
        // can leave currentStepId null while a step remains running; without repair that step is
        // never runnable again after restart.
        for (const step of runningSteps) {
          const durableCompletion = [...(mission.checkpoints || [])]
            .reverse()
            .find(c =>
              c &&
               c.payload &&
               c.payload.type === 'step-complete' &&
               c.payload.stepId === step.id &&
               c.stepAttempt === step.attempts &&
               c.stepStartedAt === step.startedAt
             );

          if (durableCompletion) {
            step.status = 'completed';
            step.completedAt = step.completedAt || durableCompletion.at;
            step.lastError = null;
            step.checkpointId = durableCompletion.id;
          } else {
            step.status = 'pending';
            step.lastError = 'interrupted:process-restart';
          }
        }

        mission.currentStepId = null;

        if (mission.steps.every(s => s.status === 'completed')) {
          mission.status = 'completed';
          mission.completedAt = mission.completedAt ||
            Math.max(...mission.steps.map(s => Number(s.completedAt || 0))) ||
            this.now();
        } else {
          mission.status = 'interrupted';
        }
        mission.updatedAt = this.now();
      }
    }
  }

  _buildCheckpoint(mission, payload = {}) {
    const at = this.now();
    const boundStepId = payload.stepId || mission.currentStepId || null;
    const boundStep = boundStepId ? mission.steps.find(step => step.id === boundStepId) : null;
    return {
      id: stableId('checkpoint', `${mission.id}:${mission.checkpoints.length}:${at}`),
      at,
      status: mission.status,
      currentStepId: mission.currentStepId,
      completedStepIds: mission.steps.filter(s => s.status === 'completed').map(s => s.id),
      previousCheckpointId: mission.checkpoints.length ? mission.checkpoints[mission.checkpoints.length - 1].id : null,
      stepAttempt: boundStep ? boundStep.attempts : null,
      stepStartedAt: boundStep ? boundStep.startedAt : null,
      payload: clone(payload)
    };
  }

  _normalizeAndValidateState(raw) {
    if (!raw || raw.schema !== 1 || !raw.missions || typeof raw.missions !== 'object' || Array.isArray(raw.missions) || !Array.isArray(raw.order)) {
      throw new Error('unsupported or corrupt mission state');
    }
    const state = clone(raw);
    const missionIds = Object.keys(state.missions);
    const normalizedOrder = [];
    const seenOrder = new Set();
    for (const id of state.order) {
      if (typeof id !== 'string' || !state.missions[id] || seenOrder.has(id)) continue;
      seenOrder.add(id);
      normalizedOrder.push(id);
    }
    const missing = missionIds
      .filter(id => !seenOrder.has(id))
      .sort((a, b) => Number(state.missions[b]?.createdAt || 0) - Number(state.missions[a]?.createdAt || 0) || a.localeCompare(b));
    state.order = [...normalizedOrder, ...missing];

    for (const [id, mission] of Object.entries(state.missions)) {
      if (!mission || mission.id !== id || !Array.isArray(mission.steps) || !Array.isArray(mission.checkpoints) || !Array.isArray(mission.toolTrace)) {
        throw new Error(`corrupt mission record ${id}`);
      }
      const stepIds = mission.steps.map(step => step && step.id);
      if (stepIds.some(stepId => typeof stepId !== 'string' || !stepId) || new Set(stepIds).size !== stepIds.length) {
        throw new Error(`duplicate or invalid step id in mission ${id}`);
      }
      const stepIdSet = new Set(stepIds);
      for (const step of mission.steps) {
        if (!Array.isArray(step.dependencies) || step.dependencies.some(dep => !stepIdSet.has(dep))) {
          throw new Error(`invalid step dependency in mission ${id}`);
        }
      }
      this._assertAcyclic(mission.steps);
      const checkpointIds = mission.checkpoints.map(checkpoint => checkpoint && checkpoint.id);
      if (checkpointIds.some(checkpointId => typeof checkpointId !== 'string' || !checkpointId) || new Set(checkpointIds).size !== checkpointIds.length) {
        throw new Error(`duplicate or invalid checkpoint id in mission ${id}`);
      }
      for (let index = 0; index < mission.checkpoints.length; index += 1) {
        const checkpoint = mission.checkpoints[index];
        if (!checkpoint.payload || typeof checkpoint.payload !== 'object') throw new Error(`invalid checkpoint payload in mission ${id}`);
        if (checkpoint.previousCheckpointId !== undefined) {
          const expectedPrevious = index === 0 ? null : mission.checkpoints[index - 1].id;
          if (checkpoint.previousCheckpointId !== expectedPrevious) throw new Error(`checkpoint chain mismatch in mission ${id}`);
        }
      }
    }
    return state;
  }

  _assertAcyclic(steps) {
    const graph = new Map(steps.map(s => [s.id, s.dependencies]));
    const visiting = new Set();
    const visited = new Set();
    const visit = id => {
      if (visiting.has(id)) throw new Error('mission dependency cycle detected');
      if (visited.has(id)) return;
      visiting.add(id);
      for (const dep of graph.get(id) || []) visit(dep);
      visiting.delete(id);
      visited.add(id);
    };
    for (const step of steps) visit(step.id);
  }

  _mission(id) {
    this._requireLoaded();
    return this._missionInState(this.state, id);
  }

  _missionInState(state, id) {
    const mission = state.missions[id];
    if (!mission) throw new Error(`unknown mission ${id}`);
    return mission;
  }

  _step(mission, id) {
    const step = mission.steps.find(s => s.id === id);
    if (!step) throw new Error(`unknown step ${id}`);
    return step;
  }

  _requireLoaded() {
    if (!this.loaded) throw new Error('mission engine is not initialized');
  }

  _mutate(operation) {
    const scheduled = this.mutationQueue.then(async () => {
      const candidate = clone(this.state);
      this.persistenceInProgress = true;
      try {
        const result = operation(candidate);
        await this.saveBackend(clone(candidate));
        this.state = candidate;
        return clone(result);
      } finally {
        this.persistenceInProgress = false;
      }
    });
    this.mutationQueue = scheduled.then(() => undefined, () => undefined);
    return scheduled;
  }
}

module.exports = { MissionEngine };
