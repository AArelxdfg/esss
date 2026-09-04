'use strict';

const { evidenceId, evidenceBindingSeal, SUMMARY_MAX_CHARS } = require('./evidence-ledger');

const EVIDENCE_ID_PATTERN = /^ev_[a-f0-9]{24}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_EVIDENCE_IDS = 32;

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
  // Bound the caller-controlled raw list before duplicate canonicalization. Without
  // this guard, a direct/core caller could submit an arbitrarily large replay list
  // that collapses to one unique ID and bypasses the desktop IPC budget.
  if (evidenceIds.length > MAX_EVIDENCE_IDS) {
    throw evidenceBindingError(
      'MISSION_EVIDENCE_IDS_LIMIT',
      `evidenceIds exceeds maximum of ${MAX_EVIDENCE_IDS}`
    );
  }

  const normalized = [];
  const seen = new Set();
  for (const value of evidenceIds) {
    if (typeof value !== 'string' || !EVIDENCE_ID_PATTERN.test(value)) {
      throw evidenceBindingError('MISSION_EVIDENCE_ID_INVALID', `invalid evidence id: ${String(value)}`);
    }
    // Evidence references are set-like bindings. Desktop/UI retries can replay the
    // same already-validated evidence ID, so canonicalize duplicates instead of
    // turning an idempotent retry into a mission failure. Integrity/context checks
    // still run once for every unique evidence record below.
    if (seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

function ledgerEntries(ledger) {
  if (!ledger) {
    throw evidenceBindingError('MISSION_EVIDENCE_LEDGER_REQUIRED', 'evidence ledger required for evidence binding');
  }

  let entries;
  try {
    entries = typeof ledger.snapshot === 'function'
      ? ledger.snapshot()
      : Array.isArray(ledger.entries)
        ? ledger.entries
        : Array.isArray(ledger)
          ? ledger
          : null;
  } catch (_) {
    throw evidenceBindingError('MISSION_EVIDENCE_LEDGER_INVALID', 'evidence ledger snapshot failed');
  }

  // Treat the ledger boundary as untrusted. A malformed snapshot must fail with a
  // stable fail-closed contract instead of falling through to an incidental
  // TypeError while resolving evidence IDs.
  if (!Array.isArray(entries)) {
    throw evidenceBindingError('MISSION_EVIDENCE_LEDGER_INVALID', 'evidence ledger does not expose an entry array');
  }
  return entries;
}

function resolveEntry(entries, id) {
  const matches = entries.filter(candidate => candidate && candidate.id === id);
  if (matches.length === 0) {
    throw evidenceBindingError('MISSION_EVIDENCE_NOT_FOUND', `evidence not found: ${id}`);
  }
  // A restored/passed-in ledger is an untrusted boundary. Multiple records with the
  // same deterministic ID make target/SHA-256 resolution ambiguous even if one
  // record happens to be valid, so never silently accept the first match.
  if (matches.length !== 1) {
    throw evidenceBindingError('MISSION_EVIDENCE_DUPLICATE', `duplicate evidence id in ledger: ${id}`);
  }
  return matches[0];
}

function validBindingIdentifier(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateEntryIntegrity(entry, id) {
  // Mission/step/tool are part of both the deterministic evidence ID and the
  // binding seal. Keep them as strict textual identifiers at the trust boundary;
  // accepting arrays/objects here would allow non-product caller shapes to enter
  // canonical hashing and make verifier context semantics ambiguous.
  if (!validBindingIdentifier(entry.missionId)) {
    throw evidenceBindingError('MISSION_EVIDENCE_MISSION_INVALID', `evidence ${id} has no valid mission binding`);
  }
  if (!validBindingIdentifier(entry.stepId)) {
    throw evidenceBindingError('MISSION_EVIDENCE_STEP_INVALID', `evidence ${id} has no valid step binding`);
  }
  if (!validBindingIdentifier(entry.tool)) {
    throw evidenceBindingError('MISSION_EVIDENCE_TOOL_INVALID', `evidence ${id} has no valid tool binding`);
  }
  if (typeof entry.target !== 'string' || entry.target.trim().length === 0) {
    throw evidenceBindingError('MISSION_EVIDENCE_TARGET_INVALID', `evidence ${id} has no valid target binding`);
  }
  if (typeof entry.sha256 !== 'string' || !SHA256_PATTERN.test(entry.sha256)) {
    throw evidenceBindingError('MISSION_EVIDENCE_SHA256_INVALID', `evidence ${id} has no valid SHA-256 result binding`);
  }
  if (typeof entry.bindingSha256 !== 'string' || !SHA256_PATTERN.test(entry.bindingSha256)) {
    throw evidenceBindingError('MISSION_EVIDENCE_BINDING_SHA256_INVALID', `evidence ${id} has no valid binding SHA-256`);
  }
  if (typeof entry.kind !== 'string' || !entry.kind.trim()) {
    throw evidenceBindingError('MISSION_EVIDENCE_KIND_INVALID', `evidence ${id} has no valid kind binding`);
  }
  if (!Number.isSafeInteger(entry.byteCount) || entry.byteCount < 0) {
    throw evidenceBindingError('MISSION_EVIDENCE_BYTE_COUNT_INVALID', `evidence ${id} has no valid byte count binding`);
  }
  if (typeof entry.observedAt !== 'string' || !Number.isFinite(Date.parse(entry.observedAt))) {
    throw evidenceBindingError('MISSION_EVIDENCE_TIMESTAMP_INVALID', `evidence ${id} has no valid observation timestamp`);
  }
  if (typeof entry.summary !== 'string' || !entry.summary.trim() || entry.summary.length > SUMMARY_MAX_CHARS) {
    throw evidenceBindingError('MISSION_EVIDENCE_SUMMARY_INVALID', `evidence ${id} has no valid bounded summary`);
  }

  const normalizedDigest = entry.sha256.toLowerCase();
  const expectedId = evidenceId({
    missionId: entry.missionId,
    stepId: entry.stepId,
    tool: entry.tool,
    kind: entry.kind,
    target: entry.target,
    sha256: normalizedDigest,
    byteCount: entry.byteCount,
    observedAt: entry.observedAt,
    summary: entry.summary
  });
  if (expectedId !== id || expectedId !== entry.id) {
    throw evidenceBindingError('MISSION_EVIDENCE_ID_BINDING_MISMATCH', `evidence ${id} identity binding mismatch`);
  }

  const expectedBinding = evidenceBindingSeal({
    missionId: entry.missionId,
    stepId: entry.stepId,
    tool: entry.tool,
    kind: entry.kind,
    target: entry.target,
    sha256: normalizedDigest,
    byteCount: entry.byteCount,
    observedAt: entry.observedAt,
    summary: entry.summary
  });
  if (expectedBinding !== entry.bindingSha256.toLowerCase()) {
    throw evidenceBindingError('MISSION_EVIDENCE_BINDING_SEAL_MISMATCH', `evidence ${id} canonical binding seal mismatch`);
  }
}

function validateEvidenceBindings({ evidenceIds, ledger, missionId, stepId, tool } = {}) {
  const ids = normalizeEvidenceIds(evidenceIds);
  if (ids.length === 0) return [];
  if (!validBindingIdentifier(missionId) || !validBindingIdentifier(stepId) || !validBindingIdentifier(tool)) {
    throw evidenceBindingError(
      'MISSION_EVIDENCE_CONTEXT_REQUIRED',
      'missionId, stepId and tool must be non-empty string identifiers for evidence binding'
    );
  }

  // Resolve one immutable validation view for the entire binding operation. Calling
  // ledger.snapshot() separately for every ID lets a mutable/adversarial ledger
  // present mutually inconsistent generations and creates a TOCTOU window across a
  // single verifier decision.
  const entries = ledgerEntries(ledger);

  return ids.map(id => {
    const entry = resolveEntry(entries, id);
    // Validate the untrusted ledger record before comparing it with trusted mission
    // context so malformed identifier shapes receive a stable integrity failure.
    validateEntryIntegrity(entry, id);
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
      kind: entry.kind,
      target: entry.target,
      sha256: entry.sha256.toLowerCase(),
      byteCount: entry.byteCount,
      observedAt: entry.observedAt,
      summary: entry.summary,
      bindingSha256: entry.bindingSha256.toLowerCase()
    };
  });
}

module.exports = {
  EVIDENCE_ID_PATTERN,
  SHA256_PATTERN,
  MAX_EVIDENCE_IDS,
  normalizeEvidenceIds,
  validateEvidenceBindings
};
