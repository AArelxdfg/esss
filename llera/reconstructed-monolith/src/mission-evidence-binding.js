'use strict';

const EVIDENCE_ID_PATTERN = /^ev_[a-f0-9]{24}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function evidenceBindingError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeEvidenceIds(evidenceIds) {
  if (evidenceIds == null) return [];
  if (!Array.isArray(evidenceIds)) {
    throw evidenceBindingError('MISSION_EVIDENCE_IDS_INVALID', 'evidenceIds must be an array');
  }

  const normalized = [];
  const seen = new Set();
  for (const value of evidenceIds) {
    if (typeof value !== 'string' || !EVIDENCE_ID_PATTERN.test(value)) {
      throw evidenceBindingError('MISSION_EVIDENCE_ID_INVALID', `invalid evidence id: ${String(value)}`);
    }
    if (!seen.has(value)) {
      seen.add(value);
      normalized.push(value);
    }
  }
  return normalized;
}

function resolveEntry(ledger, id) {
  if (!ledger) {
    throw evidenceBindingError('MISSION_EVIDENCE_LEDGER_REQUIRED', 'evidence ledger required for evidence binding');
  }

  const entries = typeof ledger.snapshot === 'function'
    ? ledger.snapshot()
    : Array.isArray(ledger.entries)
      ? ledger.entries
      : Array.isArray(ledger)
        ? ledger
        : null;

  if (!entries) {
    throw evidenceBindingError('MISSION_EVIDENCE_LEDGER_INVALID', 'evidence ledger does not expose entries');
  }

  const entry = entries.find(candidate => candidate && candidate.id === id);
  if (!entry) {
    throw evidenceBindingError('MISSION_EVIDENCE_NOT_FOUND', `evidence not found: ${id}`);
  }
  return entry;
}

function validateEntryIntegrity(entry, id) {
  if (typeof entry.target !== 'string' || entry.target.trim().length === 0) {
    throw evidenceBindingError('MISSION_EVIDENCE_TARGET_INVALID', `evidence ${id} has no valid target binding`);
  }
  if (typeof entry.sha256 !== 'string' || !SHA256_PATTERN.test(entry.sha256)) {
    throw evidenceBindingError('MISSION_EVIDENCE_SHA256_INVALID', `evidence ${id} has no valid SHA-256 result binding`);
  }
  if (typeof entry.bindingSha256 !== 'string' || !SHA256_PATTERN.test(entry.bindingSha256)) {
    throw evidenceBindingError('MISSION_EVIDENCE_BINDING_SHA256_INVALID', `evidence ${id} has no valid binding SHA-256`);
  }
}

function validateEvidenceBindings({ evidenceIds, ledger, missionId, stepId, tool } = {}) {
  const ids = normalizeEvidenceIds(evidenceIds);
  if (ids.length === 0) return [];
  if (!missionId || !stepId || !tool) {
    throw evidenceBindingError('MISSION_EVIDENCE_CONTEXT_REQUIRED', 'missionId, stepId and tool are required for evidence binding');
  }

  return ids.map(id => {
    const entry = resolveEntry(ledger, id);
    if (entry.missionId !== missionId) {
      throw evidenceBindingError('MISSION_EVIDENCE_MISSION_MISMATCH', `evidence ${id} belongs to another mission`);
    }
    if (entry.stepId !== stepId) {
      throw evidenceBindingError('MISSION_EVIDENCE_STEP_MISMATCH', `evidence ${id} belongs to another step`);
    }
    if (entry.tool !== tool) {
      throw evidenceBindingError('MISSION_EVIDENCE_TOOL_MISMATCH', `evidence ${id} belongs to another tool`);
    }
    validateEntryIntegrity(entry, id);
    return {
      id,
      missionId: entry.missionId,
      stepId: entry.stepId,
      tool: entry.tool,
      target: entry.target,
      sha256: entry.sha256,
      bindingSha256: entry.bindingSha256
    };
  });
}

module.exports = {
  EVIDENCE_ID_PATTERN,
  SHA256_PATTERN,
  normalizeEvidenceIds,
  validateEvidenceBindings
};
