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

function checkpointHead(mission) {
  const checkpoints = mission && Array.isArray(mission.checkpoints) ? mission.checkpoints : [];
  const checkpoint = checkpoints.at(-1);
  return checkpoint && checkpoint.id ? String(checkpoint.id) : null;
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
    const payload = {
      schema: 1,
      createdAt: this.now(),
      reason,
      missionId,
      missionState,
      toolTrace: Array.isArray(mission.toolTrace) ? mission.toolTrace : [],
      evidence
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

    // Recovery context must match the durable mission's latest checkpoint. Without
    // this binding an older, internally valid snapshot can replace newer evidence
    // and tool verification debt after missionEngine.init() repairs the mission.
    const currentState = this.missionEngine.snapshot();
    const currentMission = currentState.missions && currentState.missions[missionId];
    if (!currentMission) throw new Error('current mission state missing');
    const snapshotHead = checkpointHead(mission);
    const currentHead = checkpointHead(currentMission);
    if (snapshotHead !== currentHead) {
      throw new Error(`recovery snapshot checkpoint head mismatch: snapshot=${snapshotHead || 'none'} current=${currentHead || 'none'}`);
    }

    const trace = Array.isArray(payload.toolTrace) ? payload.toolTrace : [];
    const missionTrace = Array.isArray(mission.toolTrace) ? mission.toolTrace : [];
    if (stableStringify(trace) !== stableStringify(missionTrace)) {
      throw new Error('snapshot toolTrace diverges from mission state');
    }

    this.evidenceLedger.import(payload.evidence);
    this.toolGuard.restore(trace);

    return {
      missionId,
      restored: true,
      checkpointHeadId: currentHead,
      verificationDebt: this.toolGuard.verificationDebt ? { ...this.toolGuard.verificationDebt } : null,
      evidenceCount: Array.isArray(payload.evidence) ? payload.evidence.length : 0,
      digest: integrity.digest
    };
  }
}

module.exports = { RecoverySnapshotCoordinator, stableStringify, checkpointHead };
