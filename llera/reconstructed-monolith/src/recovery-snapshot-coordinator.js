'use strict';

const crypto = require('crypto');

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

class RecoverySnapshotCoordinator {
  constructor({ missionEngine, toolGuard, evidenceLedger, saveSnapshot, loadSnapshot, now = () => Date.now() } = {}) {
    if (!missionEngine || typeof missionEngine.snapshot !== 'function') {
      throw new Error('missionEngine.snapshot() is required');
    }
    if (!toolGuard || typeof toolGuard.restore !== 'function') {
      throw new Error('toolGuard.restore(toolTrace) is required');
    }
    if (!evidenceLedger || typeof evidenceLedger.export !== 'function' || typeof evidenceLedger.import !== 'function') {
      throw new Error('evidenceLedger export/import is required');
    }
    if (typeof saveSnapshot !== 'function' || typeof loadSnapshot !== 'function') {
      throw new Error('saveSnapshot/loadSnapshot are required');
    }

    this.missionEngine = missionEngine;
    this.toolGuard = toolGuard;
    this.evidenceLedger = evidenceLedger;
    this.saveSnapshot = saveSnapshot;
    this.loadSnapshot = loadSnapshot;
    this.now = now;
  }

  async create({ missionId, reason = 'checkpoint' } = {}) {
    const missionState = this.missionEngine.snapshot();
    const mission = missionState.missions && missionState.missions[missionId];
    if (!mission) throw new Error(`unknown mission ${missionId}`);

    const evidence = this.evidenceLedger.export();
    const checkpoints = Array.isArray(mission.checkpoints) ? mission.checkpoints : [];
    const checkpointHeadRecord = checkpoints.length ? checkpoints[checkpoints.length - 1] : null;
    const checkpointHead = checkpointHeadRecord ? {
      id: checkpointHeadRecord.id,
      index: checkpoints.length - 1,
      digest: sha256(stableStringify(checkpointHeadRecord))
    } : null;
    const payload = {
      schema: 1,
      createdAt: this.now(),
      reason,
      missionId,
      missionState,
      toolTrace: Array.isArray(mission.toolTrace) ? mission.toolTrace : [],
      evidence,
      checkpointHead
    };

    const canonical = stableStringify(payload);
    const envelope = {
      ...payload,
      integrity: {
        algorithm: 'sha256',
        digest: sha256(canonical)
      }
    };

    await this.saveSnapshot(envelope);
    return JSON.parse(JSON.stringify(envelope));
  }

  async restore({ missionId } = {}) {
    const snapshot = await this.loadSnapshot(missionId);
    if (!snapshot) throw new Error('recovery snapshot missing');
    if (snapshot.schema !== 1) throw new Error('unsupported recovery snapshot schema');
    if (snapshot.missionId !== missionId) throw new Error('recovery snapshot mission mismatch');
    if (!snapshot.integrity || snapshot.integrity.algorithm !== 'sha256') {
      throw new Error('recovery snapshot integrity metadata missing');
    }

    const { integrity, ...payload } = snapshot;
    const actual = sha256(stableStringify(payload));
    if (actual !== integrity.digest) {
      throw new Error('recovery snapshot integrity mismatch');
    }

    const mission = payload.missionState &&
      payload.missionState.missions &&
      payload.missionState.missions[missionId];
    if (!mission) throw new Error('snapshot mission state missing');

    const trace = Array.isArray(payload.toolTrace) ? payload.toolTrace : [];
    const missionTrace = Array.isArray(mission.toolTrace) ? mission.toolTrace : [];
    if (stableStringify(trace) !== stableStringify(missionTrace)) {
      throw new Error('snapshot toolTrace diverges from mission state');
    }

    const checkpoints = Array.isArray(mission.checkpoints) ? mission.checkpoints : [];
    const expectedHeadRecord = checkpoints.length ? checkpoints[checkpoints.length - 1] : null;
    if (!expectedHeadRecord) {
      if (payload.checkpointHead !== null) throw new Error('snapshot checkpoint head mismatch');
    } else {
      const expectedHead = {
        id: expectedHeadRecord.id,
        index: checkpoints.length - 1,
        digest: sha256(stableStringify(expectedHeadRecord))
      };
      if (stableStringify(payload.checkpointHead) !== stableStringify(expectedHead)) {
        throw new Error('snapshot checkpoint head mismatch');
      }
    }

    const priorEvidence = this.evidenceLedger.export();
    const priorGuardHistory = Array.isArray(this.toolGuard.history) ? JSON.parse(JSON.stringify(this.toolGuard.history)) : null;
    const priorVerificationDebt = this.toolGuard.verificationDebt == null
      ? null
      : JSON.parse(JSON.stringify(this.toolGuard.verificationDebt));
    try {
      this.toolGuard.restore(trace);
      this.evidenceLedger.import(payload.evidence);
    } catch (error) {
      try { this.evidenceLedger.import(priorEvidence); } catch (_) {}
      try {
        if (priorGuardHistory) this.toolGuard.restore(priorGuardHistory);
        else this.toolGuard.verificationDebt = priorVerificationDebt;
      } catch (_) {}
      throw error;
    }

    return {
      missionId,
      restored: true,
      verificationDebt: this.toolGuard.verificationDebt ? { ...this.toolGuard.verificationDebt } : null,
      evidenceCount: Array.isArray(payload.evidence) ? payload.evidence.length : 0,
      digest: integrity.digest
    };
  }
}

module.exports = { RecoverySnapshotCoordinator, stableStringify };
