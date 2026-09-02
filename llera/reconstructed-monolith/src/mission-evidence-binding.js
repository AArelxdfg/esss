'use strict';

const EVIDENCE_ID_PATTERN = /^ev_[a-f0-9]{24}$/;

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
    return {
      id,
      missionId: entry.missionId,
      stepId: entry.stepId,
      tool: entry.tool,
      target: entry.target || null,
      sha256: entry.sha256 || null,
      bindingSha256: entry.bindingSha256 || null
    };
  });
}

module.exports = {
  EVIDENCE_ID_PATTERN,
  normalizeEvidenceIds,
  validateEvidenceBindings
};
