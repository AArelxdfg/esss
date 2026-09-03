'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createMonolithToolRuntime } = require('../../src/monolith-tool-runtime');

const MAX_WORK_RESULT_BYTES = 64 * 1024;
const RESERVED_JSON_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function invalidWorkResult(message, pathName = 'result') {
  const error = new Error(`${message} at ${pathName}`);
  error.code = 'WORK_MODE_RESULT_INVALID';
  error.path = pathName;
  return error;
}

function assertLosslessJsonValue(value, pathName = 'result', seen = new Set()) {
  if (value === null) return;

  const type = typeof value;
  if (type === 'string' || type === 'boolean') return;
  if (type === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw invalidWorkResult('work step result contains a non-durable number', pathName);
    }
    return;
  }
  if (type !== 'object') {
    throw invalidWorkResult(`work step result contains unsupported ${type}`, pathName);
  }

  if (seen.has(value)) throw invalidWorkResult('work step result contains a cycle', pathName);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value);
      for (const key of ownKeys) {
        if (key === 'length') continue;
        if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key)) {
          throw invalidWorkResult('work step result array contains non-index properties', pathName);
        }
      }
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw invalidWorkResult('work step result contains a sparse array', `${pathName}[${index}]`);
        }
        assertLosslessJsonValue(value[index], `${pathName}[${index}]`, seen);
      }
      return;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw invalidWorkResult('work step result contains a non-plain object', pathName);
    }

    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') {
        throw invalidWorkResult('work step result contains a symbol key', pathName);
      }
      if (RESERVED_JSON_KEYS.has(key)) {
        throw invalidWorkResult(`work step result contains reserved key ${key}`, `${pathName}.${key}`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.enumerable !== true || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw invalidWorkResult('work step result contains a non-data property', `${pathName}.${key}`);
      }
      assertLosslessJsonValue(descriptor.value, `${pathName}.${key}`, seen);
    }
  } finally {
    seen.delete(value);
  }
}

function normalizeWorkResult(value) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    const error = new Error('work step result must be a JSON object');
    error.code = 'WORK_MODE_RESULT_INVALID';
    throw error;
  }

  // Mission/checkpoint results are restart-critical durable state. Reject values that
  // JSON.stringify would silently coerce or discard (undefined/functions, NaN,
  // sparse arrays, accessors, class instances, dangerous prototype keys, etc.) so
  // persistence never changes the semantic result behind the caller's back.
  assertLosslessJsonValue(value);

  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch (cause) {
    const error = new Error('work step result must be JSON-serializable');
    error.code = 'WORK_MODE_RESULT_INVALID';
    error.cause = cause;
    throw error;
  }

  if (encoded == null) {
    const error = new Error('work step result must be JSON-serializable');
    error.code = 'WORK_MODE_RESULT_INVALID';
    throw error;
  }

  const byteLength = Buffer.byteLength(encoded, 'utf8');
  if (byteLength > MAX_WORK_RESULT_BYTES) {
    const error = new Error(`work step result exceeds ${MAX_WORK_RESULT_BYTES} bytes`);
    error.code = 'WORK_MODE_RESULT_TOO_LARGE';
    error.byteLength = byteLength;
    error.maxBytes = MAX_WORK_RESULT_BYTES;
    throw error;
  }

  const normalized = JSON.parse(encoded);
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    const error = new Error('work step result must normalize to a JSON object');
    error.code = 'WORK_MODE_RESULT_INVALID';
    throw error;
  }
  return normalized;
}

class WorkModeService {
  constructor({ missionEngine, userData, onEvent = () => {} } = {}) {
    if (!missionEngine || typeof missionEngine.getMission !== 'function') throw new Error('missionEngine is required');
    if (!userData) throw new Error('userData is required');
    this.missions = missionEngine;
    this.userData = path.resolve(userData);
    this.workspaceRoot = path.join(this.userData, 'workspace');
    this.onEvent = onEvent;
    this.operationQueue = Promise.resolve();
    this.operationPending = 0;
    this.activeOperationMissionId = null;
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

  _enqueueMissionOperation(missionId, operation) {
    this.operationPending += 1;
    const scheduled = this.operationQueue.catch(() => {}).then(async () => {
      this.activeOperationMissionId = missionId;
      try {
        return await operation();
      } finally {
        this.activeOperationMissionId = null;
      }
    });
    this.operationQueue = scheduled.finally(() => {
      this.operationPending = Math.max(0, this.operationPending - 1);
    });
    return scheduled;
  }

  status(missionId) {
    const mission = this._mission(missionId);
    // The guarded tool broker is intentionally a single shared execution boundary.
    // Never restore it with another mission's trace while an async operation owns it;
    // doing so could cross-contaminate anti-loop/failure/verification-debt state.
    if (this.activeOperationMissionId && this.activeOperationMissionId !== missionId) {
      const error = new Error(`Work Mode is executing mission ${this.activeOperationMissionId}; status restore for ${missionId} is temporarily blocked`);
      error.code = 'WORK_MODE_CROSS_MISSION_OPERATION_BUSY';
      throw error;
    }
    if (!this.activeOperationMissionId) this.runtime.missionTools.restoreMission(missionId);
    return clone({
      mission,
      execution: this.runtime.missionTools.status(missionId),
      coverage: this.runtime.coverage()
    });
  }

  async startMission(missionId) {
    return this._enqueueMissionOperation(missionId, () => this._startMission(missionId));
  }

  async _startMission(missionId) {
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
    return this._enqueueMissionOperation(missionId, () => this._beginNextStep(missionId));
  }

  async _beginNextStep(missionId) {
    let mission = this._mission(missionId);
    if (['pending', 'paused', 'interrupted'].includes(mission.status)) await this._startMission(missionId);
    mission = this._mission(missionId);
    if (mission.status !== 'running') throw new Error(`mission is not runnable from ${mission.status}`);
    if (mission.currentStepId) return this.status(missionId);
    const next = this.missions.nextRunnableStep(missionId);
    if (!next) return this.status(missionId);
    await this.missions.beginStep(missionId, next.id);
    this._emit('mission.step.started', { missionId, stepId: next.id });
    return this.status(missionId);
  }

  async pauseMission(missionId, reason = 'user-pause') {
    return this._enqueueMissionOperation(missionId, () => this._pauseMission(missionId, reason));
  }

  async _pauseMission(missionId, reason = 'user-pause') {
    const mission = this._mission(missionId);
    if (mission.status !== 'running') {
      const error = new Error(`cannot pause mission from ${mission.status}`);
      error.code = 'WORK_MODE_MISSION_NOT_RUNNING';
      throw error;
    }
    await this.missions.pauseMission(missionId, reason);
    this.runtime.missionTools.restoreMission(missionId);
    this._emit('mission.paused', { missionId, reason: String(reason || 'user-pause') });
    return this.status(missionId);
  }

  async invokeTool(request = {}) {
    return this._enqueueMissionOperation(request.missionId, () => this._invokeTool(request));
  }

  async _invokeTool({ missionId, stepId = null, tool, args = {}, materialAuthorization = false } = {}) {
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
    // Rebind the shared guard immediately before every tool operation. The global
    // operation queue guarantees no second mission can replace this trace until the
    // real tool result, durable trace and checkpoint have all been persisted.
    this.runtime.missionTools.restoreMission(missionId);
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

  async completeCurrentStep(missionId, expectedStepId = null, result = {}) {
    // Preserve the internal two-argument service API for older callers, while the
    // desktop IPC always supplies an expected step id to reject stale UI requests.
    if (expectedStepId && typeof expectedStepId === 'object' && !Array.isArray(expectedStepId)) {
      result = expectedStepId;
      expectedStepId = null;
    }
    // Checkpoint payloads are durable product state. Bound and normalize renderer- or
    // planner-provided completion results before they enter the mission mutation queue
    // so malformed/cyclic/oversized payloads cannot poison mission persistence.
    const normalizedResult = normalizeWorkResult(result);
    return this._enqueueMissionOperation(missionId, () => this._completeCurrentStep(missionId, expectedStepId, normalizedResult));
  }

  async _completeCurrentStep(missionId, expectedStepId = null, result = {}) {
    const mission = this._mission(missionId);
    if (mission.status !== 'running') {
      const error = new Error(`mission is not runnable from ${mission.status}`);
      error.code = 'WORK_MODE_MISSION_NOT_RUNNING';
      throw error;
    }
    if (!mission.currentStepId) throw new Error('mission has no active step');
    if (expectedStepId != null && expectedStepId !== mission.currentStepId) {
      const error = new Error(`completion step ${expectedStepId} does not match active mission step ${mission.currentStepId}`);
      error.code = 'WORK_MODE_STEP_MISMATCH';
      throw error;
    }
    this.runtime.missionTools.restoreMission(missionId);
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

module.exports = { WorkModeService, MAX_WORK_RESULT_BYTES, normalizeWorkResult, assertLosslessJsonValue };
