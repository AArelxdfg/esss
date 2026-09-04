'use strict';

const { evidenceId, evidenceBindingSeal, SUMMARY_MAX_CHARS } = require('./evidence-ledger');

const MAX_EVIDENCE = 256;
const MAX_CHECKS = 256;
const MAX_EVIDENCE_REFS = 64;

const EVIDENCE_BINDING_REASONS = Object.freeze([
  'invalid_evidence_binding',
  'invalid_evidence_id',
  'incomplete_evidence_binding',
  'invalid_evidence_tool',
  'invalid_evidence_byte_count',
  'invalid_evidence_binding_sha256',
  'evidence_id_binding_mismatch',
  'evidence_binding_seal_mismatch',
  'evidence_summary_too_long'
]);

function isNonEmptyText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateEnrichedEvidence(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return {ok:false, reason:'invalid_evidence_binding'};
  if (typeof item.id !== 'string' || !/^ev_[a-f0-9]{24}$/i.test(item.id)) return {ok:false, reason:'invalid_evidence_id'};
  if (typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(item.sha256)) return {ok:false, reason:'invalid_evidence_binding'};
  if (!isNonEmptyText(item.tool)) return {ok:false, reason:'invalid_evidence_tool'};
  const requiredText = ['missionId','stepId','kind','target','observedAt','summary'];
  if (requiredText.some(key => !isNonEmptyText(item[key]))) return {ok:false, reason:'incomplete_evidence_binding'};
  if (!Number.isSafeInteger(item.byteCount) || item.byteCount < 0) return {ok:false, reason:'invalid_evidence_byte_count'};
  if (typeof item.bindingSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(item.bindingSha256)) {
    return {ok:false, reason:'invalid_evidence_binding_sha256'};
  }
  if (item.summary.length > SUMMARY_MAX_CHARS) return {ok:false, reason:'evidence_summary_too_long'};

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
    const out = Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonical(value[key], seen);
      return result;
    }, {});
    seen.delete(value);
    return out;
  }
  return value;
}

function checkSetSignature(checks) {
  return JSON.stringify(canonical(Array.isArray(checks) ? checks : []));
}

function semanticKeys(checks) {
  if (!Array.isArray(checks)) return new Set();
  return new Set(checks.map((check, index) => {
    if (!check || typeof check !== 'object' || Array.isArray(check)) return `invalid:${index}`;
    const explicit = check.independenceKey ?? check.semanticKey;
    if (explicit !== undefined) {
      if (!isNonEmptyText(explicit)) return `invalid:${index}`;
      return `explicit:${explicit.trim()}`;
    }
    if ((check.name !== undefined && typeof check.name !== 'string') ||
        (check.detail !== undefined && typeof check.detail !== 'string')) return `invalid:${index}`;
    return `implicit:${String(check.name || '').trim()}\u0000${String(check.detail || '').trim()}`;
  }));
}

function validatePayload(evidence, checks, prefix) {
  if (!Array.isArray(evidence)) return {ok:false, reason:'invalid_evidence_list'};
  if (evidence.length > MAX_EVIDENCE) return {ok:false, reason:'evidence_limit_exceeded'};
  if (!Array.isArray(checks)) return {ok:false, reason:`${prefix}_checks_invalid`};
  if (checks.length > MAX_CHECKS) return {ok:false, reason:`${prefix}_check_limit_exceeded`};
  for (const raw of checks) {
    if (raw && Array.isArray(raw.evidenceIds) && raw.evidenceIds.length > MAX_EVIDENCE_REFS) {
      return {ok:false, reason:`${prefix}_evidence_ref_limit_exceeded`};
    }
  }
  return {ok:true};
}

function normalizeEvidenceRefs(raw) {
  if (!raw || !Array.isArray(raw.evidenceIds)) return [];
  const refs = [];
  const seen = new Set();
  for (const value of raw.evidenceIds) {
    if (!isNonEmptyText(value)) continue;
    const id = value.trim();
    if (!seen.has(id)) {
      seen.add(id);
      refs.push(id);
    }
  }
  return refs;
}

class StrictEvidenceVerifier {
  constructor({ threshold = 0.62, minEvidenceCoverage = 1, requireEvidenceRefs = true, engineId = 'strict-evidence-v2' } = {}) {
    this.threshold = threshold;
    this.minEvidenceCoverage = minEvidenceCoverage;
    this.requireEvidenceRefs = requireEvidenceRefs;
    this.engineId = engineId;
  }

  verify({ evidence = [], checks = [] } = {}) {
    const payload = validatePayload(evidence, checks, 'strict');
    if (!payload.ok) return {ok:false, reason:payload.reason, score:0, coverage:0, checks:[]};
    const knownIds = new Set(evidence.map(e => e && e.id));
    for (const item of evidence) {
      const invalid = this.validateEvidence(item);
      if (!invalid.ok) return { ok:false, reason:invalid.reason, score:0, coverage:0, checks:[] };
    }

    if (checks.length === 0) {
      return { ok:false, reason:'strict_no_checks', score:0, coverage:0, passed:0, total:0, failures:['no_checks'], checks:[] };
    }

    const normalized = checks.map((raw, index) => {
      const refs = normalizeEvidenceRefs(raw);
      const unknownEvidenceIds = refs.filter(id => !knownIds.has(id));
      const missingEvidenceRefs = this.requireEvidenceRefs && refs.length === 0;
      const bindingOk = !missingEvidenceRefs && unknownEvidenceIds.length === 0;
      const declaredOk = Boolean(raw && raw.ok);
      return {
        name: raw && typeof raw.name === 'string' && raw.name.trim() ? raw.name : `strict_check_${index + 1}`,
        ok: declaredOk && bindingOk,
        declaredOk,
        weight: Number.isFinite(raw && raw.weight) && raw.weight > 0 ? raw.weight : 1,
        detail: raw && typeof raw.detail === 'string' ? raw.detail : '',
        evidenceIds: refs,
        unknownEvidenceIds,
        bindingOk
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
    const payload = validatePayload(evidence, checks, 'adversarial');
    if (!payload.ok) return {ok:false, reason:payload.reason, score:0, coverage:0, checks:[]};
    const knownIds = new Set(evidence.map(e => e && e.id));
    for (const item of evidence) {
      const invalid = this.validateEvidence(item);
      if (!invalid.ok) return { ok:false, reason:invalid.reason, score:0, coverage:0, checks:[] };
    }

    if (checks.length === 0) {
      return { ok:false, reason:'adversarial_no_checks', score:0, coverage:0, passed:0, total:0, failures:['no_checks'], checks:[] };
    }

    const normalized = checks.map((raw, index) => {
      const refs = normalizeEvidenceRefs(raw);
      const unknownEvidenceIds = refs.filter(id => !knownIds.has(id));
      const missingEvidenceRefs = this.requireEvidenceRefs && refs.length === 0;
      const bindingOk = !missingEvidenceRefs && unknownEvidenceIds.length === 0;
      const declaredOk = Boolean(raw && raw.ok);
      const severityValue = raw && typeof raw.severity === 'string' ? raw.severity.toLowerCase() : '';
      const severity = ['critical','high','normal'].includes(severityValue) ? severityValue : 'normal';
      return {
        name: raw && typeof raw.name === 'string' && raw.name.trim() ? raw.name : `adversarial_check_${index + 1}`,
        ok: declaredOk && bindingOk,
        declaredOk,
        severity,
        detail: raw && typeof raw.detail === 'string' ? raw.detail : '',
        evidenceIds: refs,
        unknownEvidenceIds,
        bindingOk
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

    if (this.strictVerifier === this.adversarialVerifier) throw new Error('strict and adversarial verifiers must be separate instances');
    if (!this.strictVerifier || typeof this.strictVerifier.verify !== 'function' || !this.adversarialVerifier || typeof this.adversarialVerifier.verify !== 'function') {
      throw new Error('strict/adversarial verifier implementations are required');
    }
    if (!this.strictVerifier.engineId || !this.adversarialVerifier.engineId) throw new Error('strict/adversarial verifier engineId is required');
    if (this.strictVerifier.engineId === this.adversarialVerifier.engineId) throw new Error('strict and adversarial verifier engineId must differ');
  }

  verify({claim, evidence = [], strictChecks = [], adversarialChecks = []}) {
    if (!claim) return {ok:false, reason:'claim_required'};
    if (!Array.isArray(evidence) || evidence.length === 0) return {ok:false, reason:'evidence_required'};
    if (evidence.length > MAX_EVIDENCE) return {ok:false, reason:'evidence_limit_exceeded'};
    if (!Array.isArray(strictChecks)) return {ok:false, reason:'strict_checks_invalid'};
    if (!Array.isArray(adversarialChecks)) return {ok:false, reason:'adversarial_checks_invalid'};
    if (strictChecks.length > MAX_CHECKS) return {ok:false, reason:'strict_check_limit_exceeded'};
    if (adversarialChecks.length > MAX_CHECKS) return {ok:false, reason:'adversarial_check_limit_exceeded'};
    if (strictChecks.some(raw => raw && Array.isArray(raw.evidenceIds) && raw.evidenceIds.length > MAX_EVIDENCE_REFS)) {
      return {ok:false, reason:'strict_evidence_ref_limit_exceeded'};
    }
    if (adversarialChecks.some(raw => raw && Array.isArray(raw.evidenceIds) && raw.evidenceIds.length > MAX_EVIDENCE_REFS)) {
      return {ok:false, reason:'adversarial_evidence_ref_limit_exceeded'};
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
    if (missionIds.length !== 1) return {ok:false, reason:'mixed_mission_evidence_reject', missionIds};

    let sameCheckSet;
    let strictSemanticKeys;
    let adversarialSemanticKeys;
    try {
      sameCheckSet = checkSetSignature(strictChecks) === checkSetSignature(adversarialChecks);
      strictSemanticKeys = semanticKeys(strictChecks);
      adversarialSemanticKeys = semanticKeys(adversarialChecks);
    } catch (_) {
      return {ok:false, reason:'verifier_check_metadata_invalid', missionId:missionIds[0]};
    }
    const sameCheckReference = strictChecks === adversarialChecks;
    const semanticOverlap = [...strictSemanticKeys].filter(key => adversarialSemanticKeys.has(key));
    if (this.requireIndependentChecks && (sameCheckReference || sameCheckSet || semanticOverlap.length > 0)) {
      return {
        ok:false,
        reason:'verifier_check_independence_reject',
        missionId:missionIds[0],
        independence:{sameCheckReference,sameCheckSet,semanticOverlap,required:true}
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
  MAX_EVIDENCE,
  MAX_CHECKS,
  MAX_EVIDENCE_REFS,
  EVIDENCE_BINDING_REASONS,
  validateEnrichedEvidence,
  checkSetSignature,
  semanticKeys,
  StrictEvidenceVerifier,
  AdversarialEvidenceVerifier,
  DualVerifier
};
