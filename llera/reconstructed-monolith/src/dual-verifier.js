'use strict';

const { evidenceId, evidenceBindingSeal, SUMMARY_MAX_CHARS } = require('./evidence-ledger');

const MAX_VERIFIER_EVIDENCE = 256;
const MAX_VERIFIER_CHECKS = 256;
const MAX_CHECK_EVIDENCE_REFS = 64;

const EVIDENCE_BINDING_REASONS = Object.freeze([
  'invalid_evidence_binding',
  'invalid_evidence_id',
  'incomplete_evidence_binding',
  'invalid_evidence_field_type',
  'invalid_evidence_tool',
  'invalid_evidence_byte_count',
  'invalid_evidence_binding_sha256',
  'invalid_evidence_timestamp',
  'evidence_id_binding_mismatch',
  'evidence_binding_seal_mismatch',
  'evidence_summary_too_long'
]);

const TEXTUAL_EVIDENCE_FIELDS = Object.freeze([
  'missionId', 'stepId', 'tool', 'kind', 'target', 'observedAt', 'summary'
]);

function validateEnrichedEvidence(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return {ok:false, reason:'invalid_evidence_binding'};
  if (typeof item.id !== 'string' || !/^ev_[a-f0-9]{24}$/i.test(item.id)) return {ok:false, reason:'invalid_evidence_id'};
  if (typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(item.sha256)) return {ok:false, reason:'invalid_evidence_binding'};

  for (const field of TEXTUAL_EVIDENCE_FIELDS) {
    if (typeof item[field] !== 'string') return {ok:false, reason:'invalid_evidence_field_type', field};
    if (!item[field].trim()) return {ok:false, reason:'incomplete_evidence_binding', field};
  }
  if (!Number.isSafeInteger(item.byteCount) || item.byteCount < 0) return {ok:false, reason:'invalid_evidence_byte_count'};
  if (typeof item.bindingSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(item.bindingSha256)) {
    return {ok:false, reason:'invalid_evidence_binding_sha256'};
  }
  if (!Number.isFinite(Date.parse(item.observedAt))) {
    return {ok:false, reason:'invalid_evidence_timestamp'};
  }
  if (item.summary.length > SUMMARY_MAX_CHARS) {
    return {ok:false, reason:'evidence_summary_too_long'};
  }

  const normalizedDigest = item.sha256.toLowerCase();
  const expectedId = evidenceId({
    missionId:item.missionId,
    stepId:item.stepId,
    kind:item.kind,
    tool:item.tool,
    target:item.target,
    sha256:normalizedDigest,
    byteCount:item.byteCount,
    observedAt:item.observedAt,
    summary:item.summary
  });
  if (expectedId !== item.id) return {ok:false, reason:'evidence_id_binding_mismatch'};

  const expectedBinding = evidenceBindingSeal({
    missionId:item.missionId,
    stepId:item.stepId,
    tool:item.tool,
    kind:item.kind,
    target:item.target,
    sha256:normalizedDigest,
    byteCount:item.byteCount,
    observedAt:item.observedAt,
    summary:item.summary
  });
  if (expectedBinding !== item.bindingSha256.toLowerCase()) {
    return {ok:false, reason:'evidence_binding_seal_mismatch'};
  }
  return {ok:true};
}

function canonical(value, seen = new WeakSet()) {
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError('circular_verifier_metadata');
    seen.add(value);
    const out = value.map(item => canonical(item, seen));
    seen.delete(value);
    return out;
  }
  if (value && typeof value === 'object') {
    if (seen.has(value)) throw new TypeError('circular_verifier_metadata');
    seen.add(value);
    const out = Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = canonical(value[key], seen);
      return acc;
    }, {});
    seen.delete(value);
    return out;
  }
  return value;
}

function checkSetSignature(checks) {
  return JSON.stringify(canonical(Array.isArray(checks) ? checks : []));
}

function safeText(value) {
  return typeof value === 'string' ? value : '';
}

function semanticKeyList(checks) {
  if (!Array.isArray(checks)) return [];
  return checks.map((check, index) => {
    if (!check || typeof check !== 'object' || Array.isArray(check)) return `invalid:${index}`;
    const explicit = check.independenceKey ?? check.semanticKey;
    if (typeof explicit === 'string' && explicit.trim()) return `explicit:${explicit.trim()}`;
    return `implicit:${safeText(check.name).trim()}\u0000${safeText(check.detail).trim()}`;
  });
}

function semanticKeys(checks) {
  return new Set(semanticKeyList(checks));
}

function duplicateSemanticKeys(checks) {
  const seen = new Set();
  const duplicates = new Set();
  for (const key of semanticKeyList(checks)) {
    if (seen.has(key)) duplicates.add(key);
    else seen.add(key);
  }
  return [...duplicates];
}

function normalizeEvidenceRefs(raw) {
  if (!Array.isArray(raw)) return [];
  if (raw.length > MAX_CHECK_EVIDENCE_REFS) return null;
  const refs = [];
  for (const id of raw) {
    if (typeof id !== 'string' || !/^ev_[a-f0-9]{24}$/i.test(id)) return null;
    if (!refs.includes(id)) refs.push(id);
  }
  return refs;
}

function listBoundary(evidence, checks, prefix) {
  if (!Array.isArray(evidence)) return {ok:false, reason:`${prefix}_invalid_evidence_list`};
  if (evidence.length > MAX_VERIFIER_EVIDENCE) return {ok:false, reason:`${prefix}_evidence_limit_reject`};
  if (!Array.isArray(checks)) return {ok:false, reason:`${prefix}_invalid_check_list`};
  if (checks.length > MAX_VERIFIER_CHECKS) return {ok:false, reason:`${prefix}_check_limit_reject`};
  return {ok:true};
}

class StrictEvidenceVerifier {
  constructor({ threshold = 0.62, minEvidenceCoverage = 1, requireEvidenceRefs = true, engineId = 'strict-evidence-v2' } = {}) {
    this.threshold = threshold;
    this.minEvidenceCoverage = minEvidenceCoverage;
    this.requireEvidenceRefs = requireEvidenceRefs;
    this.engineId = engineId;
  }

  verify({ evidence = [], checks = [] } = {}) {
    const boundary = listBoundary(evidence, checks, 'strict');
    if (!boundary.ok) return {ok:false, reason:boundary.reason, score:0, coverage:0, checks:[]};

    const knownIds = new Set(evidence.map(e => e && e.id));
    for (const item of evidence) {
      const invalid = this.validateEvidence(item);
      if (!invalid.ok) return { ok:false, reason:invalid.reason, score:0, coverage:0, checks:[] };
    }

    if (checks.length === 0) {
      return { ok:false, reason:'strict_no_checks', score:0, coverage:0, passed:0, total:0, failures:['no_checks'], checks:[] };
    }

    const normalized = checks.map((raw, index) => {
      const refs = normalizeEvidenceRefs(raw && raw.evidenceIds);
      const refsValid = refs !== null;
      const safeRefs = refsValid ? refs : [];
      const unknownEvidenceIds = safeRefs.filter(id => !knownIds.has(id));
      const missingEvidenceRefs = this.requireEvidenceRefs && safeRefs.length === 0;
      const bindingOk = refsValid && !missingEvidenceRefs && unknownEvidenceIds.length === 0;
      const declaredOk = Boolean(raw) && raw.ok === true;
      return {
        name: raw && typeof raw.name === 'string' && raw.name.trim() ? raw.name : `strict_check_${index + 1}`,
        ok: declaredOk && bindingOk,
        declaredOk,
        weight: Number.isFinite(raw && raw.weight) && raw.weight > 0 ? raw.weight : 1,
        detail: raw && typeof raw.detail === 'string' ? raw.detail : '',
        evidenceIds: safeRefs,
        unknownEvidenceIds,
        bindingOk,
        evidenceRefsValid: refsValid
      };
    });

    const totalWeight = normalized.reduce((sum, check) => sum + check.weight, 0);
    const passedWeight = normalized.filter(check => check.ok).reduce((sum, check) => sum + check.weight, 0);
    const score = totalWeight ? passedWeight / totalWeight : 0;
    const referenced = new Set();
    for (const check of normalized) {
      if (!check.ok) continue;
      for (const id of check.evidenceIds) if (knownIds.has(id)) referenced.add(id);
    }
    const coverage = knownIds.size ? referenced.size / knownIds.size : 0;
    const ok = score >= this.threshold && coverage >= this.minEvidenceCoverage;
    return {
      ok,
      reason: ok ? 'strict_pass' : (coverage < this.minEvidenceCoverage ? 'strict_coverage_reject' : 'strict_score_reject'),
      engineId:this.engineId,
      score,
      coverage,
      passed: normalized.filter(check => check.ok).length,
      total: normalized.length,
      failures: normalized.filter(check => !check.ok).map(check => check.name),
      checks: normalized
    };
  }

  validateEvidence(item) {
    return validateEnrichedEvidence(item);
  }
}

class AdversarialEvidenceVerifier {
  constructor({ threshold = 0.62, minEvidenceCoverage = 1, requireEvidenceRefs = true, engineId = 'adversarial-evidence-v2' } = {}) {
    this.threshold = threshold;
    this.minEvidenceCoverage = minEvidenceCoverage;
    this.requireEvidenceRefs = requireEvidenceRefs;
    this.engineId = engineId;
  }

  verify({ evidence = [], checks = [] } = {}) {
    const boundary = listBoundary(evidence, checks, 'adversarial');
    if (!boundary.ok) return {ok:false, reason:boundary.reason, score:0, coverage:0, checks:[]};

    const knownIds = new Set(evidence.map(e => e && e.id));
    for (const item of evidence) {
      const invalid = this.validateEvidence(item);
      if (!invalid.ok) return { ok:false, reason:invalid.reason, score:0, coverage:0, checks:[] };
    }

    if (checks.length === 0) {
      return { ok:false, reason:'adversarial_no_checks', score:0, coverage:0, passed:0, total:0, failures:['no_checks'], checks:[] };
    }

    const normalized = checks.map((raw, index) => {
      const refs = normalizeEvidenceRefs(raw && raw.evidenceIds);
      const refsValid = refs !== null;
      const safeRefs = refsValid ? refs : [];
      const unknownEvidenceIds = safeRefs.filter(id => !knownIds.has(id));
      const missingEvidenceRefs = this.requireEvidenceRefs && safeRefs.length === 0;
      const bindingOk = refsValid && !missingEvidenceRefs && unknownEvidenceIds.length === 0;
      const declaredOk = Boolean(raw) && raw.ok === true;
      const severityRaw = raw && typeof raw.severity === 'string' ? raw.severity.toLowerCase() : '';
      const severity = ['critical','high','normal'].includes(severityRaw) ? severityRaw : 'normal';
      return {
        name: raw && typeof raw.name === 'string' && raw.name.trim() ? raw.name : `adversarial_check_${index + 1}`,
        ok: declaredOk && bindingOk,
        declaredOk,
        severity,
        detail: raw && typeof raw.detail === 'string' ? raw.detail : '',
        evidenceIds: safeRefs,
        unknownEvidenceIds,
        bindingOk,
        evidenceRefsValid: refsValid
      };
    });

    const criticalFailure = normalized.some(check => check.severity === 'critical' && !check.ok);
    const passed = normalized.filter(check => check.ok).length;
    const rawScore = normalized.length ? passed / normalized.length : 0;
    const score = criticalFailure ? 0 : rawScore;

    const referenced = new Set();
    for (const check of normalized) {
      if (!check.ok) continue;
      for (const id of check.evidenceIds) if (knownIds.has(id)) referenced.add(id);
    }
    const coverage = knownIds.size ? referenced.size / knownIds.size : 0;
    const ok = !criticalFailure && score >= this.threshold && coverage >= this.minEvidenceCoverage;
    return {
      ok,
      reason: ok ? 'adversarial_pass'
        : (criticalFailure ? 'adversarial_critical_counterexample'
          : (coverage < this.minEvidenceCoverage ? 'adversarial_coverage_reject' : 'adversarial_score_reject')),
      engineId:this.engineId,
      score,
      coverage,
      passed,
      total: normalized.length,
      failures: normalized.filter(check => !check.ok).map(check => check.name),
      checks: normalized,
      criticalFailure
    };
  }

  validateEvidence(item) {
    return validateEnrichedEvidence(item);
  }
}

class DualVerifier {
  constructor({
    strictThreshold = 0.62,
    adversarialThreshold = 0.62,
    minEvidenceCoverage = 1,
    requireEvidenceRefs = true,
    requireIndependentChecks = true,
    strictVerifier = null,
    adversarialVerifier = null
  } = {}) {
    this.strictVerifier = strictVerifier || new StrictEvidenceVerifier({
      threshold:strictThreshold,
      minEvidenceCoverage,
      requireEvidenceRefs
    });
    this.adversarialVerifier = adversarialVerifier || new AdversarialEvidenceVerifier({
      threshold:adversarialThreshold,
      minEvidenceCoverage,
      requireEvidenceRefs
    });
    this.requireIndependentChecks = requireIndependentChecks !== false;

    if (this.strictVerifier === this.adversarialVerifier) {
      throw new Error('strict and adversarial verifiers must be separate instances');
    }
    if (!this.strictVerifier || typeof this.strictVerifier.verify !== 'function' || !this.adversarialVerifier || typeof this.adversarialVerifier.verify !== 'function') {
      throw new Error('strict/adversarial verifier implementations are required');
    }
    if (!this.strictVerifier.engineId || !this.adversarialVerifier.engineId) {
      throw new Error('strict/adversarial verifier engineId is required');
    }
    if (this.strictVerifier.engineId === this.adversarialVerifier.engineId) {
      throw new Error('strict and adversarial verifier engineId must differ');
    }
  }

  verify({claim, evidence = [], strictChecks = [], adversarialChecks = []}) {
    if (typeof claim !== 'string' || !claim.trim()) return {ok:false, reason:'claim_required'};
    if (!Array.isArray(evidence) || evidence.length === 0) return {ok:false, reason:'evidence_required'};
    if (evidence.length > MAX_VERIFIER_EVIDENCE) return {ok:false, reason:'verifier_evidence_limit_reject'};
    if (!Array.isArray(strictChecks) || !Array.isArray(adversarialChecks)) return {ok:false, reason:'verifier_check_list_required'};
    if (strictChecks.length > MAX_VERIFIER_CHECKS || adversarialChecks.length > MAX_VERIFIER_CHECKS) {
      return {ok:false, reason:'verifier_check_limit_reject'};
    }

    for (const item of evidence) {
      const invalid = typeof this.strictVerifier.validateEvidence === 'function'
        ? this.strictVerifier.validateEvidence(item)
        : validateEnrichedEvidence(item);
      if (!invalid.ok) return {ok:false, reason:invalid.reason, strict:null, adversarial:null};
    }

    const ids = evidence.map(e => e && e.id);
    if (new Set(ids).size !== ids.length) return {ok:false, reason:'duplicate_evidence_id'};

    const missionIds = [...new Set(evidence.map(e => e.missionId.trim()))];
    if (missionIds.length !== 1) {
      return {ok:false, reason:'mixed_mission_evidence_reject', missionIds};
    }

    const sameCheckReference = strictChecks === adversarialChecks;
    let sameCheckSet;
    let strictSemanticKeys;
    let adversarialSemanticKeys;
    let strictDuplicateSemanticKeys;
    let adversarialDuplicateSemanticKeys;
    try {
      sameCheckSet = checkSetSignature(strictChecks) === checkSetSignature(adversarialChecks);
      strictSemanticKeys = semanticKeys(strictChecks);
      adversarialSemanticKeys = semanticKeys(adversarialChecks);
      strictDuplicateSemanticKeys = duplicateSemanticKeys(strictChecks);
      adversarialDuplicateSemanticKeys = duplicateSemanticKeys(adversarialChecks);
    } catch (_) {
      return {ok:false, reason:'verifier_check_metadata_invalid', missionId:missionIds[0]};
    }
    const semanticOverlap = [...strictSemanticKeys].filter(key => adversarialSemanticKeys.has(key));
    if (this.requireIndependentChecks && (
      sameCheckReference ||
      sameCheckSet ||
      semanticOverlap.length > 0 ||
      strictDuplicateSemanticKeys.length > 0 ||
      adversarialDuplicateSemanticKeys.length > 0
    )) {
      return {
        ok:false,
        reason:'verifier_check_independence_reject',
        missionId:missionIds[0],
        independence:{
          sameCheckReference,
          sameCheckSet,
          semanticOverlap,
          strictDuplicateSemanticKeys,
          adversarialDuplicateSemanticKeys,
          required:true
        }
      };
    }

    const strict = this.strictVerifier.verify({ claim, evidence, checks:strictChecks });
    if (strict.reason && EVIDENCE_BINDING_REASONS.includes(strict.reason)) {
      return {ok:false, reason:strict.reason, missionId:missionIds[0], strict, adversarial:null};
    }
    const adversarial = this.adversarialVerifier.verify({ claim, evidence, checks:adversarialChecks });
    if (adversarial.reason && EVIDENCE_BINDING_REASONS.includes(adversarial.reason)) {
      return {ok:false, reason:adversarial.reason, missionId:missionIds[0], strict, adversarial};
    }

    const evidenceCoverage = Math.min(strict.coverage || 0, adversarial.coverage || 0);
    const ok = strict.ok === true && adversarial.ok === true;
    return {
      ok,
      claim,
      missionId:missionIds[0],
      strict,
      adversarial,
      evidenceCoverage,
      coverage: {
        strict: strict.coverage || 0,
        adversarial: adversarial.coverage || 0,
        required: Math.max(this.strictVerifier.minEvidenceCoverage || 0, this.adversarialVerifier.minEvidenceCoverage || 0)
      },
      evidenceIds: ids,
      independence: {
        strictEngineId:this.strictVerifier.engineId,
        adversarialEngineId:this.adversarialVerifier.engineId,
        distinctInstances:true,
        distinctEngineIds:true,
        sameCheckReference,
        sameCheckSet,
        semanticOverlap,
        strictDuplicateSemanticKeys,
        adversarialDuplicateSemanticKeys,
        required:this.requireIndependentChecks
      },
      reason: ok
        ? 'dual_verifier_pass'
        : ((strict.reason || '').includes('coverage') || (adversarial.reason || '').includes('coverage')
          ? 'evidence_coverage_reject'
          : 'dual_verifier_reject')
    };
  }
}

module.exports = {
  MAX_VERIFIER_EVIDENCE,
  MAX_VERIFIER_CHECKS,
  MAX_CHECK_EVIDENCE_REFS,
  EVIDENCE_BINDING_REASONS,
  TEXTUAL_EVIDENCE_FIELDS,
  validateEnrichedEvidence,
  checkSetSignature,
  semanticKeys,
  duplicateSemanticKeys,
  StrictEvidenceVerifier,
  AdversarialEvidenceVerifier,
  DualVerifier
};
