'use strict';

const { MissionToolCoordinator } = require('./mission-tool-coordinator');
const { validateEvidenceBindings } = require('./mission-evidence-binding');

class EvidenceBoundMissionToolCoordinator extends MissionToolCoordinator {
  constructor({ evidenceLedger = null, evidenceLedgerResolver = null, ...options } = {}) {
    super(options);
    if (evidenceLedgerResolver != null && typeof evidenceLedgerResolver !== 'function') {
      throw new Error('evidenceLedgerResolver must be a function when provided');
    }
    this.evidenceLedger = evidenceLedger;
    this.evidenceLedgerResolver = evidenceLedgerResolver;
  }

  _ledgerForMission(missionId) {
    return this.evidenceLedgerResolver
      ? this.evidenceLedgerResolver(missionId)
      : this.evidenceLedger;
  }

  async invoke(request = {}) {
    const evidenceIds = request.evidenceIds;
    if (evidenceIds == null || (Array.isArray(evidenceIds) && evidenceIds.length === 0)) {
      return super.invoke(request);
    }

    const mission = this.missionEngine.getMission(request.missionId);
    if (!mission) return super.invoke(request);
    if (mission.status !== 'running') return super.invoke(request);

    // Resolve the exact active step before touching the guarded broker. This keeps
    // syntactically valid but stale/cross-step evidence from authorizing any real
    // operation or contaminating durable mission state.
    const activeStepId = this._resolveStepBinding(mission, request.stepId == null ? null : request.stepId);
    const ledger = this._ledgerForMission(request.missionId);
    const bindings = validateEvidenceBindings({
      evidenceIds,
      ledger,
      missionId: request.missionId,
      stepId: activeStepId,
      tool: request.tool
    });

    return super.invoke({
      ...request,
      stepId: activeStepId,
      evidenceIds: bindings.map(binding => binding.id)
    });
  }
}

module.exports = { EvidenceBoundMissionToolCoordinator };
