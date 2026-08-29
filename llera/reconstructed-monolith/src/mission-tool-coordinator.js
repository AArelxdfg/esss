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
    const recoverySnapshotDebt = this._recoverySnapshotDebt(mission);
    const broker = this.broker.status();
    return {
      missionId,
      missionStatus: mission.status,
      currentStepId: mission.currentStepId,
      toolTraceCount: (mission.toolTrace || []).length,
      recoverySnapshotDebt,
      canFinalize: Boolean(broker.canFinalize) && !recoverySnapshotDebt,
      broker
    };
  }

  async invoke({ missionId, stepId = null, tool, args = {}, context = {}, evidenceIds = [] } = {}) {
    if (!tool) throw new Error('tool is required');
    const mission = this.missionEngine.getMission(missionId);
    if (!mission) throw new Error(`unknown mission ${missionId}`);
    const activeStepId = stepId || mission.currentStepId || null;

    this.broker.restore(mission.toolTrace || []);

    const recoverySnapshotDebt = this._recoverySnapshotDebt(mission);
    const classification = this._classify(tool);
    if (recoverySnapshotDebt && classification.material) {
      return {
        ok: false,
        blocked: true,
        reason: 'recovery_snapshot_debt_open',
        persisted: false,
        missionId,
        stepId: activeStepId,
        recoverySnapshotDebt
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
      outcome,
      material: Boolean(trace.material),
      verification: Boolean(trace.observation),
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
    const debt = this._recoverySnapshotDebt(mission);
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
      checkpoint,
      snapshot: snapshot || null
    };
  }

  canFinalize(missionId) {
    this.restoreMission(missionId);
    const mission = this.missionEngine.getMission(missionId);
    return Boolean(this.broker.status().canFinalize) && !this._recoverySnapshotDebt(mission);
  }

  _classify(tool) {
    if (this.broker.guard && typeof this.broker.guard.classify === 'function') {
      return this.broker.guard.classify(tool);
    }
    return { material: false, observation: false };
  }

  _recoverySnapshotDebt(mission) {
    const checkpoints = Array.isArray(mission && mission.checkpoints) ? mission.checkpoints : [];
    let debt = null;
    for (const checkpoint of checkpoints) {
      const type = checkpoint && checkpoint.payload && checkpoint.payload.type;
      if (type === 'recovery-snapshot-debt') debt = checkpoint;
      if (type === 'recovery-snapshot-repaired') {
        const debtId = checkpoint.payload.debtCheckpointId;
        if (!debtId || (debt && debt.id === debtId)) debt = null;
      }
    }
    return debt ? {
      id: debt.id,
      at: debt.at || null,
      stepId: debt.payload.stepId || null,
      traceId: debt.payload.traceId || null,
      tool: debt.payload.tool || null,
      error: debt.payload.error || null
    } : null;
  }
}

module.exports = { MissionToolCoordinator };
