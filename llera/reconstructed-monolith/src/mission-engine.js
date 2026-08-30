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
    if (typeof load !== 'function' || typeof save !== 'function') throw new Error('load/save persistence functions are required');
    this.loadBackend = load; this.saveBackend = save; this.now = now;
    this.state = { schema: 1, missions: {}, order: [] }; this.durableState = clone(this.state);
    this.loaded = false; this.persistenceInFlight = false;
  }

  async init() {
    if (this.loaded) return this.snapshot();
    const persisted = await this.loadBackend();
    if (persisted) {
      if (persisted.schema !== 1 || !persisted.missions || !Array.isArray(persisted.order)) throw new Error('unsupported or corrupt mission state');
      this.state = clone(persisted); this.durableState = clone(persisted);
      this._repairInterruptedState(); await this._persist();
    }
    this.loaded = true; return this.snapshot();
  }

  snapshot() { return clone(this.state); }
  getMission(id) { const mission = this.state.missions[id]; return mission ? clone(mission) : null; }
  listMissions() { return this.state.order.map(id => clone(this.state.missions[id])).filter(Boolean); }

  async createMission({ title, goal, mode = 'work', steps = [], budget = {} } = {}) {
    this._requireLoaded(); this._assertMutationAvailable();
    if (!title || !goal) throw new Error('title and goal are required');
    if (!['conversation', 'work'].includes(mode)) throw new Error('mode must be conversation or work');
    if (!Array.isArray(steps) || steps.length === 0) throw new Error('at least one mission step is required');
    const createdAt = this.now();
    const id = stableId('mission', `${createdAt}:${title}:${goal}:${this.state.order.length}`);
    if (this.state.missions[id]) throw new Error('mission id collision');
    const normalizedSteps = steps.map((step, index) => {
      const name = typeof step === 'string' ? step : step.name;
      if (!name) throw new Error(`step ${index} requires a name`);
      const dependencies = typeof step === 'string' ? [] : (step.dependencies || []);
      return { id: step.id || stableId('step', `${id}:${index}:${name}`), name, status: 'pending', dependencies: [...dependencies], attempts: 0, startedAt: null, completedAt: null, lastError: null, checkpointId: null };
    });
    const ids = new Set(normalizedSteps.map(s => s.id));
    for (const step of normalizedSteps) for (const dep of step.dependencies) { if (!ids.has(dep)) throw new Error(`unknown dependency ${dep}`); if (dep === step.id) throw new Error(`step ${step.id} cannot depend on itself`); }
    this._assertAcyclic(normalizedSteps);
    const mission = { id, title, goal, mode, status: 'pending', createdAt, updatedAt: createdAt, startedAt: null, completedAt: null, currentStepId: null, resumeCount: 0, budget: { maxSteps: Number.isFinite(budget.maxSteps) ? budget.maxSteps : normalizedSteps.length, maxAttemptsPerStep: Number.isFinite(budget.maxAttemptsPerStep) ? budget.maxAttemptsPerStep : 3 }, steps: normalizedSteps, checkpoints: [], toolTrace: [] };
    if (mission.budget.maxSteps < normalizedSteps.length) throw new Error('budget maxSteps is below mission step count');
    this.state.missions[id] = mission; this.state.order.unshift(id); await this._persist(); return clone(mission);
  }

  async startMission(id) {
    const mission = this._mission(id); this._assertMutationAvailable();
    if (!['pending', 'paused', 'interrupted'].includes(mission.status)) throw new Error(`cannot start mission from ${mission.status}`);
    if (!mission.startedAt) mission.startedAt = this.now(); if (mission.status === 'interrupted') mission.resumeCount += 1;
    mission.status = 'running'; mission.updatedAt = this.now(); await this._persist(); return clone(mission);
  }

  nextRunnableStep(id) {
    const mission = this._mission(id); if (mission.status !== 'running') return null;
    const complete = new Set(mission.steps.filter(s => s.status === 'completed').map(s => s.id));
    const step = mission.steps.find(s => s.status === 'pending' && s.dependencies.every(dep => complete.has(dep)));
    return step ? clone(step) : null;
  }

  async beginStep(missionId, stepId) {
    const mission = this._mission(missionId); this._assertMutationAvailable();
    if (mission.status !== 'running') throw new Error('mission is not running');
    if (mission.currentStepId) throw new Error(`mission already has active step ${mission.currentStepId}`);
    const step = this._step(mission, stepId); if (step.status !== 'pending') throw new Error(`cannot begin step from ${step.status}`);
    const completed = new Set(mission.steps.filter(s => s.status === 'completed').map(s => s.id));
    if (!step.dependencies.every(dep => completed.has(dep))) throw new Error('step dependencies are not complete');
    if (step.attempts >= mission.budget.maxAttemptsPerStep) throw new Error('step attempt budget exhausted');
    step.status = 'running'; step.attempts += 1; step.startedAt = this.now(); step.lastError = null;
    mission.currentStepId = step.id; mission.updatedAt = this.now(); await this._persist(); return clone(step);
  }

  async appendToolTrace(missionId, entry = {}) {
    const mission = this._mission(missionId); this._assertMutationAvailable(); if (!entry.tool) throw new Error('tool is required');
    const record = { id: stableId('trace', `${mission.id}:${mission.toolTrace.length}:${this.now()}:${entry.tool}`), at: this.now(), stepId: entry.stepId || mission.currentStepId || null, tool: entry.tool, argumentsHash: entry.argumentsHash || null, outcome: entry.outcome || 'observed', material: Boolean(entry.material), verification: Boolean(entry.verification), evidenceIds: [...(entry.evidenceIds || [])] };
    mission.toolTrace.push(record); mission.updatedAt = record.at; await this._persist(); return clone(record);
  }

  async checkpoint(missionId, payload = {}) {
    const mission = this._mission(missionId); this._assertMutationAvailable(); const checkpoint = this._buildCheckpoint(mission, payload);
    mission.checkpoints.push(checkpoint); if (mission.currentStepId) this._step(mission, mission.currentStepId).checkpointId = checkpoint.id;
    mission.updatedAt = checkpoint.at; await this._persist(); return clone(checkpoint);
  }

  async completeStep(missionId, stepId, result = {}) {
    const mission = this._mission(missionId); this._assertMutationAvailable();
    if (mission.currentStepId !== stepId) throw new Error('step is not the active mission step');
    const step = this._step(mission, stepId); if (step.status !== 'running') throw new Error('step is not running');
    const completedAt = this.now(); step.status = 'completed'; step.completedAt = completedAt; step.lastError = null; mission.currentStepId = null;
    if (mission.steps.every(s => s.status === 'completed')) { mission.status = 'completed'; mission.completedAt = completedAt; }
    const checkpoint = this._buildCheckpoint(mission, { type: 'step-complete', stepId, result }); step.checkpointId = checkpoint.id; mission.checkpoints.push(checkpoint); mission.updatedAt = checkpoint.at;
    await this._persist(); return clone(mission);
  }

  async failStep(missionId, stepId, error) {
    const mission = this._mission(missionId); this._assertMutationAvailable(); if (mission.currentStepId !== stepId) throw new Error('step is not the active mission step');
    const step = this._step(mission, stepId); step.status = step.attempts >= mission.budget.maxAttemptsPerStep ? 'failed' : 'pending';
    step.lastError = String(error?.message || error || 'unknown error'); mission.currentStepId = null; mission.status = step.status === 'failed' ? 'failed' : 'running'; mission.updatedAt = this.now();
    await this._persist(); return clone(mission);
  }

  async pauseMission(id, reason = 'user-pause') {
    const mission = this._mission(id); this._assertMutationAvailable(); if (mission.status !== 'running') throw new Error('only running missions can be paused');
    if (mission.currentStepId) { const step = this._step(mission, mission.currentStepId); step.status = 'pending'; step.lastError = `interrupted:${reason}`; mission.currentStepId = null; }
    mission.status = 'paused'; mission.updatedAt = this.now(); await this._persist(); return clone(mission);
  }

  _repairInterruptedState() {
    for (const id of this.state.order) {
      const mission = this.state.missions[id]; if (!mission) continue;
      const runningSteps = (mission.steps || []).filter(step => step && step.status === 'running');
      if (mission.status !== 'running' && !mission.currentStepId && runningSteps.length === 0) continue;

      for (const step of runningSteps) {
        const durableCompletion = [...(mission.checkpoints || [])].reverse().find(c => c && c.payload && c.payload.type === 'step-complete' && c.payload.stepId === step.id);
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
        mission.completedAt = mission.completedAt || Math.max(...mission.steps.map(s => Number(s.completedAt || 0))) || this.now();
      } else {
        mission.status = 'interrupted';
      }
      mission.updatedAt = this.now();
    }
  }

  _buildCheckpoint(mission, payload = {}) {
    const at = this.now(); return { id: stableId('checkpoint', `${mission.id}:${mission.checkpoints.length}:${at}`), at, status: mission.status, currentStepId: mission.currentStepId, completedStepIds: mission.steps.filter(s => s.status === 'completed').map(s => s.id), payload: clone(payload) };
  }

  _assertAcyclic(steps) {
    const graph = new Map(steps.map(s => [s.id, s.dependencies])); const visiting = new Set(); const visited = new Set();
    const visit = id => { if (visiting.has(id)) throw new Error('mission dependency cycle detected'); if (visited.has(id)) return; visiting.add(id); for (const dep of graph.get(id) || []) visit(dep); visiting.delete(id); visited.add(id); };
    for (const step of steps) visit(step.id);
  }

  _mission(id) { this._requireLoaded(); const mission = this.state.missions[id]; if (!mission) throw new Error(`unknown mission ${id}`); return mission; }
  _step(mission, id) { const step = mission.steps.find(s => s.id === id); if (!step) throw new Error(`unknown step ${id}`); return step; }
  _requireLoaded() { if (!this.loaded) throw new Error('mission engine is not initialized'); }
  _assertMutationAvailable() { if (!this.persistenceInFlight) return; const error = new Error('mission persistence transaction already in progress'); error.code = 'MISSION_PERSISTENCE_IN_PROGRESS'; throw error; }
  async _persist() { this._assertMutationAvailable(); const candidate = clone(this.state); this.persistenceInFlight = true; try { await this.saveBackend(candidate); this.durableState = clone(candidate); } catch (error) { this.state = clone(this.durableState); throw error; } finally { this.persistenceInFlight = false; } }
}

module.exports = { MissionEngine };
