'use strict';
const { fingerprint } = require('./tool-surface');

class MissionToolCoordinator {
  constructor({ missionEngine, broker, recoverySnapshots = null, autoCheckpoint = true } = {}) {
    if (!missionEngine || typeof missionEngine.appendToolTrace !== 'function' || typeof missionEngine.checkpoint !== 'function') {
      throw new Error('missionEngine appendToolTrace/checkpoint is required');
    }
    if (!broker || typeof broker.invoke !== 'function' || typeof broker.restore !== 'function') {
      throw new Error('guarded broker invoke/restore is required');
    }
    this.missionEngine = missionEngine;
    this.broker = broker;
    this.recoverySnapshots = recoverySnapshots;
    this.autoCheckpoint = Boolean(autoCheckpoint);
  }

  restoreMission(missionId) {
    const mission = this.missionEngine.getMission(missionId);
    if (!mission) throw new Error(`unknown mission ${missionId}`);
    return this.broker.restore(mission.toolTrace || []);
  }

  status(missionId) {
    const mission = this.missionEngine.getMission(missionId);
    if (!mission) throw new Error(`unknown mission ${missionId}`);
    const recoverySnapshotDebts = this._recoverySnapshotDebts(mission);
    const recoverySnapshotDebt = recoverySnapshotDebts[0] || null;
    const broker = this.broker.status();
    return {
      missionId,
      missionStatus: mission.status,
      currentStepId: mission.currentStepId,
      toolTraceCount: (mission.toolTrace || []).length,
      recoverySnapshotDebt,
      recoverySnapshotDebts,
      recoverySnapshotDebtCount: recoverySnapshotDebts.length,
      canFinalize: Boolean(broker.canFinalize) && recoverySnapshotDebts.length === 0,
      broker
    };
  }

  async invoke({ missionId, stepId = null, tool, args = {}, context = {}, evidenceIds = [] } = {}) {
    if (!tool) throw new Error('tool is required');
    const mission = this.missionEngine.getMission(missionId);
    if (!mission) throw new Error(`unknown mission ${missionId}`);
    if (mission.status !== 'running') {
      const error = new Error(`mission is not runnable from ${mission.status}`);
      error.code = 'MISSION_TOOL_MISSION_NOT_RUNNING';
      throw error;
    }
    const activeStepId = this._resolveStepBinding(mission, stepId);

    this.broker.restore(mission.toolTrace || []);

    const recoverySnapshotDebts = this._recoverySnapshotDebts(mission);
    const recoverySnapshotDebt = recoverySnapshotDebts[0] || null;
    const classification = this._classify(tool);
    if (recoverySnapshotDebt && classification.material) {
      return {
        ok: false,
        blocked: true,
        reason: 'recovery_snapshot_debt_open',
        persisted: false,
        missionId,
        stepId: activeStepId,
        recoverySnapshotDebt,
        recoverySnapshotDebtCount: recoverySnapshotDebts.length
      };
    }

    const before = this.broker.status();
    const result = await this.broker.invoke(tool, args, { ...context, missionId, stepId: activeStepId });
    if (result.blocked) return { ...result, persisted: false, missionId, stepId: activeStepId };

    const trace = result.trace || {};
    const outcome = result.ok ? (trace.observation ? 'observed' : 'success') : 'failed';
    const persisted = await this.missionEngine.appendToolTrace(missionId, {
      stepId: activeStepId,
      tool,
      argumentsHash: trace.fingerprint || fingerprint(tool, args),
      semanticFingerprint: trace.semanticFingerprint || null,
      outcome,
      material: Boolean(trace.material),
      verification: Boolean(trace.observation),
      observation: Boolean(trace.observation),
      scope: trace.scope || null,
      verifiesFingerprint: trace.verifies || trace.verifiesFingerprint || null,
      evidenceIds
    });

    let checkpoint = null;
    const verificationClosedDebt = Boolean(before.verificationDebt) && !result.verificationDebt;
    const shouldCheckpoint = this.autoCheckpoint && result.ok && (Boolean(trace.material) || verificationClosedDebt);

    if (shouldCheckpoint) {
      checkpoint = await this.missionEngine.checkpoint(missionId, {
        type: trace.material ? 'material-action' : 'verification',
        stepId: activeStepId,
        traceId: persisted.id,
        tool,
        verificationDebt: result.verificationDebt || null
      });
    }

    let recoverySnapshot = null;
    if (this.recoverySnapshots && shouldCheckpoint) {
      try {
        const created = await this.recoverySnapshots.create({
          missionId,
          reason: trace.material ? 'post-material-action' : 'post-verification'
        });
        recoverySnapshot = { ok: true, debt: false, snapshot: created || null };
      } catch (error) {
        const message = String(error && error.message || error);
        const debtCheckpoint = await this.missionEngine.checkpoint(missionId, {
          type: 'recovery-snapshot-debt',
          stepId: activeStepId,
          traceId: persisted.id,
          tool,
          sourceCheckpointId: checkpoint && checkpoint.id || null,
          error: message
        });
        recoverySnapshot = {
          ok: false,
          debt: true,
          error: message,
          debtCheckpointId: debtCheckpoint.id
        };
      }
    }

    return {
      ...result,
      persisted: true,
      persistedTrace: persisted,
      checkpoint,
      recoverySnapshot,
      degraded: Boolean(recoverySnapshot && recoverySnapshot.debt),
      missionId,
      stepId: activeStepId
    };
  }

  async repairRecoverySnapshot(missionId, reason = 'recovery-snapshot-repair') {
    if (!this.recoverySnapshots || typeof this.recoverySnapshots.create !== 'function') {
      throw new Error('recovery snapshot service is unavailable');
    }
    const mission = this.missionEngine.getMission(missionId);
    if (!mission) throw new Error(`unknown mission ${missionId}`);
    const debts = this._recoverySnapshotDebts(mission);
    const debt = debts[0] || null;
    if (!debt) return { repaired: false, reason: 'no_recovery_snapshot_debt', missionId };

    const snapshot = await this.recoverySnapshots.create({ missionId, reason });
    const checkpoint = await this.missionEngine.checkpoint(missionId, {
      type: 'recovery-snapshot-repaired',
      debtCheckpointId: debt.id,
      reason
    });

    return {
      repaired: true,
      missionId,
      debtCheckpointId: debt.id,
      remainingDebtCount: Math.max(0, debts.length - 1),
      checkpoint,
      snapshot: snapshot || null
    };
  }

  canFinalize(missionId) {
    this.restoreMission(missionId);
    const mission = this.missionEngine.getMission(missionId);
    return Boolean(this.broker.status().canFinalize) && this._recoverySnapshotDebts(mission).length === 0;
  }

  _resolveStepBinding(mission, requestedStepId) {
    const currentStepId = mission && mission.currentStepId || null;
    if (!currentStepId) {
      const error = new Error('mission has no active step');
      error.code = 'MISSION_TOOL_NO_ACTIVE_STEP';
      throw error;
    }
    if (requestedStepId == null) return currentStepId;
    if (typeof requestedStepId !== 'string' || requestedStepId.length === 0) {
      throw new Error('stepId must be a non-empty string when provided');
    }
    const exists = Array.isArray(mission.steps) && mission.steps.some(step => step && step.id === requestedStepId);
    if (!exists) throw new Error(`unknown mission step ${requestedStepId}`);
    if (currentStepId !== requestedStepId) {
      throw new Error(`mission step binding mismatch: active ${currentStepId}, requested ${requestedStepId}`);
    }
    return requestedStepId;
  }

  _classify(tool) {
    if (this.broker.guard && typeof this.broker.guard.classify === 'function') {
      return this.broker.guard.classify(tool);
    }
    return { material: false, observation: false };
  }

  _recoverySnapshotDebt(mission) {
    return this._recoverySnapshotDebts(mission)[0] || null;
  }

  _recoverySnapshotDebts(mission) {
    const checkpoints = Array.isArray(mission && mission.checkpoints) ? mission.checkpoints : [];
    const open = new Map();

    for (const checkpoint of checkpoints) {
      if (!checkpoint || !checkpoint.id || !checkpoint.payload) continue;
      const type = checkpoint.payload.type;

      if (type === 'recovery-snapshot-debt') {
        open.set(checkpoint.id, checkpoint);
        continue;
      }

      if (type === 'recovery-snapshot-repaired') {
        const debtId = checkpoint.payload.debtCheckpointId;
        if (typeof debtId === 'string' && debtId.length > 0 && open.has(debtId)) {
          open.delete(debtId);
        }
      }
    }

    return [...open.values()].map(checkpoint => ({
      id: checkpoint.id,
      at: checkpoint.at || null,
      stepId: checkpoint.payload.stepId || null,
      traceId: checkpoint.payload.traceId || null,
      tool: checkpoint.payload.tool || null,
      error: checkpoint.payload.error || null
    }));
  }
}

module.exports = { MissionToolCoordinator };
