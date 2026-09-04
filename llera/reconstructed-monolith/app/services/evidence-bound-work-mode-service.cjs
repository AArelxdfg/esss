'use strict';

const path = require('node:path');
const { EvidenceLedger } = require('../../src/evidence-ledger');
const { WorkModeService } = require('./work-mode-service.cjs');

class EvidenceBoundWorkModeService extends WorkModeService {
  constructor(options = {}) {
    super(options);
    const userData = path.resolve(options.userData || '');
    this.runtime.missionTools.evidenceLedgerResolver = missionId => new EvidenceLedger({
      missionId,
      storagePath: path.join(userData, 'evidence', `${missionId}.json`)
    });
  }

  async _invokeTool({ missionId, stepId = null, tool, args = {}, materialAuthorization = false, evidenceIds = [] } = {}) {
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

    this.runtime.missionTools.restoreMission(missionId);
    const result = await this.runtime.missionTools.invoke({
      missionId,
      stepId: activeStepId,
      tool,
      args,
      evidenceIds,
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
      checkpointId: result.checkpoint?.id || null,
      evidenceIds: Array.isArray(result.persistedTrace?.evidenceIds) ? result.persistedTrace.evidenceIds : []
    });
    return JSON.parse(JSON.stringify(result));
  }
}

module.exports = { EvidenceBoundWorkModeService };
