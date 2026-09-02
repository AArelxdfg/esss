'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createMonolithToolRuntime } = require('../../src/monolith-tool-runtime');

function clone(value) { return JSON.parse(JSON.stringify(value)); }

class WorkModeService {
  constructor({ missionEngine, userData, onEvent = () => {} } = {}) {
    if (!missionEngine || typeof missionEngine.getMission !== 'function') throw new Error('missionEngine is required');
    if (!userData) throw new Error('userData is required');
    this.missions = missionEngine;
    this.userData = path.resolve(userData);
    this.workspaceRoot = path.join(this.userData, 'workspace');
    this.onEvent = onEvent;
    fs.mkdirSync(this.workspaceRoot, { recursive: true });
    this.runtime = createMonolithToolRuntime({
      missionEngine: this.missions,
      workspaceRoot: this.workspaceRoot,
      allowOutsideWorkspace: false,
      actionAuthorizer: async ({ context }) => ({
        allow: Boolean(context && context.source === 'desktop-work-mode' && context.materialAuthorization === true)
      })
    });
  }

  _emit(type, detail = {}) {
    const event = { type, detail: clone(detail), at: new Date().toISOString() };
    this.onEvent(event);
    return event;
  }

  _mission(missionId) {
    const mission = this.missions.getMission(missionId);
    if (!mission) throw new Error(`unknown mission ${missionId}`);
    return mission;
  }

  status(missionId) {
    const mission = this._mission(missionId);
    this.runtime.missionTools.restoreMission(missionId);
    return clone({
      mission,
      execution: this.runtime.missionTools.status(missionId),
      coverage: this.runtime.coverage()
    });
  }

  async startMission(missionId) {
    let mission = this._mission(missionId);
    if (['pending', 'paused', 'interrupted'].includes(mission.status)) {
      mission = await this.missions.startMission(missionId);
    } else if (mission.status !== 'running') {
      throw new Error(`cannot start mission from ${mission.status}`);
    }
    this.runtime.missionTools.restoreMission(missionId);
    this._emit('mission.started', { missionId });
    return this.status(missionId);
  }

  async beginNextStep(missionId) {
    let mission = this._mission(missionId);
    if (['pending', 'paused', 'interrupted'].includes(mission.status)) await this.startMission(missionId);
    mission = this._mission(missionId);
    if (mission.status !== 'running') throw new Error(`mission is not runnable from ${mission.status}`);
    if (mission.currentStepId) return this.status(missionId);
    const next = this.missions.nextRunnableStep(missionId);
    if (!next) return this.status(missionId);
    await this.missions.beginStep(missionId, next.id);
    this._emit('mission.step.started', { missionId, stepId: next.id });
    return this.status(missionId);
  }

  async invokeTool({ missionId, stepId = null, tool, args = {}, materialAuthorization = false } = {}) {
    const mission = this._mission(missionId);
    if (mission.status !== 'running') {
      const error = new Error(`mission is not runnable from ${mission.status}`);
      error.code = 'WORK_MODE_MISSION_NOT_RUNNING';
      throw error;
    }
    const activeStepId = mission.currentStepId;
    if (!activeStepId) throw new Error('mission has no active step');
    if (stepId && stepId !== activeStepId) {
      const error = new Error(`tool step ${stepId} does not match active mission step ${activeStepId}`);
      error.code = 'WORK_MODE_STEP_MISMATCH';
      throw error;
    }
    const result = await this.runtime.missionTools.invoke({
      missionId,
      stepId: activeStepId,
      tool,
      args,
      context: {
        source: 'desktop-work-mode',
        materialAuthorization: materialAuthorization === true
      }
    });
    this._emit(result.blocked ? 'mission.tool.blocked' : 'mission.tool.executed', {
      missionId,
      stepId: activeStepId,
      tool,
      ok: Boolean(result.ok),
      blocked: Boolean(result.blocked),
      reason: result.reason || null,
      traceId: result.persistedTrace?.id || null,
      checkpointId: result.checkpoint?.id || null
    });
    return clone(result);
  }

  async completeCurrentStep(missionId, result = {}) {
    const mission = this._mission(missionId);
    if (!mission.currentStepId) throw new Error('mission has no active step');
    const execution = this.runtime.missionTools.status(missionId);
    if (execution.verificationDebt || !execution.canFinalize) {
      return clone({
        blocked: true,
        reason: execution.recoverySnapshotDebt ? 'recovery_snapshot_debt_open' : 'verification_debt_open',
        status: this.status(missionId)
      });
    }
    const stepId = mission.currentStepId;
    await this.missions.completeStep(missionId, stepId, result);
    this._emit('mission.step.completed', { missionId, stepId });
    return clone({ blocked: false, status: this.status(missionId) });
  }
}

module.exports = { WorkModeService };
