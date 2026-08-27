'use strict';
const { fingerprint } = require('./tool-surface');
class MissionToolCoordinator {
  constructor({ missionEngine, broker, recoverySnapshots = null, autoCheckpoint = true } = {}) {
    if (!missionEngine || typeof missionEngine.appendToolTrace !== 'function' || typeof missionEngine.checkpoint !== 'function') throw new Error('missionEngine appendToolTrace/checkpoint is required');
    if (!broker || typeof broker.invoke !== 'function' || typeof broker.restore !== 'function') throw new Error('guarded broker invoke/restore is required');
    this.missionEngine = missionEngine; this.broker = broker; this.recoverySnapshots = recoverySnapshots; this.autoCheckpoint = Boolean(autoCheckpoint);
  }
  restoreMission(missionId) {
    const mission = this.missionEngine.getMission(missionId); if (!mission) throw new Error(`unknown mission ${missionId}`);
    return this.broker.restore(mission.toolTrace || []);
  }
  status(missionId) {
    const mission = this.missionEngine.getMission(missionId); if (!mission) throw new Error(`unknown mission ${missionId}`);
    return { missionId, missionStatus: mission.status, currentStepId: mission.currentStepId, toolTraceCount: (mission.toolTrace || []).length, broker: this.broker.status() };
  }
  async invoke({ missionId, stepId = null, tool, args = {}, context = {}, evidenceIds = [] } = {}) {
    if (!tool) throw new Error('tool is required');
    const mission = this.missionEngine.getMission(missionId); if (!mission) throw new Error(`unknown mission ${missionId}`);
    const activeStepId = stepId || mission.currentStepId || null;
    this.broker.restore(mission.toolTrace || []);
    const before = this.broker.status();
    const result = await this.broker.invoke(tool, args, { ...context, missionId, stepId: activeStepId });
    if (result.blocked) return { ...result, persisted: false, missionId, stepId: activeStepId };
    const trace = result.trace || {};
    const outcome = result.ok ? (trace.observation ? 'observed' : 'success') : 'failed';
    const persisted = await this.missionEngine.appendToolTrace(missionId, {
      stepId: activeStepId, tool, argumentsHash: trace.fingerprint || fingerprint(tool, args), outcome,
      material: Boolean(trace.material), verification: Boolean(trace.observation), evidenceIds
    });
    let checkpoint = null;
    const verificationClosedDebt = Boolean(before.verificationDebt) && !result.verificationDebt;
    const shouldCheckpoint = this.autoCheckpoint && result.ok && (Boolean(trace.material) || verificationClosedDebt);
    if (shouldCheckpoint) {
      checkpoint = await this.missionEngine.checkpoint(missionId, {
        type: trace.material ? 'material-action' : 'verification', stepId: activeStepId, traceId: persisted.id, tool,
        verificationDebt: result.verificationDebt || null
      });
    }
    if (this.recoverySnapshots && shouldCheckpoint) {
      await this.recoverySnapshots.create({ missionId, reason: trace.material ? 'post-material-action' : 'post-verification' });
    }
    return { ...result, persisted: true, persistedTrace: persisted, checkpoint, missionId, stepId: activeStepId };
  }
  canFinalize(missionId) { this.restoreMission(missionId); return this.broker.status().canFinalize; }
}
module.exports = { MissionToolCoordinator };
