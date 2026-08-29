'use strict';

const { evidenceId } = require('./evidence-ledger');

class StrictEvidenceVerifier {
  constructor({ threshold = 0.62, minEvidenceCoverage = 1, requireEvidenceRefs = true, engineId = 'strict-evidence-v1' } = {}) {
    this.threshold = threshold;
    this.minEvidenceCoverage = minEvidenceCoverage;
    this.requireEvidenceRefs = requireEvidenceRefs;
    this.engineId = engineId;
  }

  verify({ evidence = [], checks = [] } = {}) {
    const knownIds = new Set(evidence.map(e => e.id));
    for (const item of evidence) {
      const invalid = this.validateEvidence(item);
      if (!invalid.ok) return { ok:false, reason:invalid.reason, score:0, coverage:0, checks:[] };
    }

    if (!Array.isArray(checks) || checks.length === 0) {
      return { ok:false, reason:'strict_no_checks', score:0, coverage:0, passed:0, total:0, failures:['no_checks'], checks:[] };
    }

    const normalized = checks.map((raw, index) => {
      const refs = Array.isArray(raw && raw.evidenceIds)
        ? [...new Set(raw.evidenceIds.filter(Boolean).map(String))]
        : [];
      const unknownEvidenceIds = refs.filter(id => !knownIds.has(id));
      const missingEvidenceRefs = this.requireEvidenceRefs && refs.length === 0;
      const bindingOk = !missingEvidenceRefs && unknownEvidenceIds.length === 0;
      const declaredOk = Boolean(raw && raw.ok);
      return {
        name: raw && raw.name ? String(raw.name) : `strict_check_${index + 1}`,
        ok: declaredOk && bindingOk,
        declaredOk,
        weight: Number.isFinite(raw && raw.weight) && raw.weight > 0 ? raw.weight : 1,
        detail: raw && raw.detail ? String(raw.detail) : '',
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
    if (!item || typeof item !== 'object') return {ok:false, reason:'invalid_evidence_binding'};
    if (!item.id || !/^ev_[a-f0-9]{24}$/i.test(item.id)) return {ok:false, reason:'invalid_evidence_id'};
    if (!/^[a-f0-9]{64}$/i.test(item.sha256 || '')) return {ok:false, reason:'invalid_evidence_binding'};
    if (!item.missionId || !item.stepId || !item.kind || !item.target) return {ok:false, reason:'incomplete_evidence_binding'};
    const expected = evidenceId({
      missionId:item.missionId,
      stepId:item.stepId,
      kind:item.kind,
      target:item.target,
      sha256:String(item.sha256).toLowerCase()
    });
    return expected === item.id ? {ok:true} : {ok:false, reason:'evidence_id_binding_mismatch'};
  }
}

class AdversarialEvidenceVerifier {
  constructor({ threshold = 0.62, minEvidenceCoverage = 1, requireEvidenceRefs = true, engineId = 'adversarial-evidence-v1' } = {}) {
    this.threshold = threshold;
    this.minEvidenceCoverage = minEvidenceCoverage;
    this.requireEvidenceRefs = requireEvidenceRefs;
    this.engineId = engineId;
  }

  verify({ evidence = [], checks = [] } = {}) {
    const knownIds = new Set(evidence.map(e => e.id));
    for (const item of evidence) {
      const invalid = this.validateEvidence(item);
      if (!invalid.ok) return { ok:false, reason:invalid.reason, score:0, coverage:0, checks:[] };
    }

    if (!Array.isArray(checks) || checks.length === 0) {
      return { ok:false, reason:'adversarial_no_checks', score:0, coverage:0, passed:0, total:0, failures:['no_checks'], checks:[] };
    }

    const normalized = checks.map((raw, index) => {
      const refs = Array.isArray(raw && raw.evidenceIds)
        ? [...new Set(raw.evidenceIds.filter(Boolean).map(String))]
        : [];
      const unknownEvidenceIds = refs.filter(id => !knownIds.has(id));
      const missingEvidenceRefs = this.requireEvidenceRefs && refs.length === 0;
      const bindingOk = !missingEvidenceRefs && unknownEvidenceIds.length === 0;
      const declaredOk = Boolean(raw && raw.ok);
      const severity = ['critical','high','normal'].includes(String(raw && raw.severity || '').toLowerCase())
        ? String(raw.severity).toLowerCase()
        : 'normal';
      return {
        name: raw && raw.name ? String(raw.name) : `adversarial_check_${index + 1}`,
        ok: declaredOk && bindingOk,
        declaredOk,
        severity,
        detail: raw && raw.detail ? String(raw.detail) : '',
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
    if (item === null || typeof item !== 'object') return {ok:false, reason:'invalid_evidence_binding'};
    if (typeof item.id !== 'string' || !/^ev_[0-9a-f]{24}$/i.test(item.id)) return {ok:false, reason:'invalid_evidence_id'};
    if (typeof item.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(item.sha256)) return {ok:false, reason:'invalid_evidence_binding'};
    const required = ['missionId','stepId','kind','target'];
    if (required.some(key => !String(item[key] || '').trim())) return {ok:false, reason:'incomplete_evidence_binding'};
    const expectedId = evidenceId({
      missionId:item.missionId,
      stepId:item.stepId,
      target:item.target,
      sha256:item.sha256.toLowerCase(),
      kind:item.kind
    });
    if (item.id !== expectedId) return {ok:false, reason:'evidence_id_binding_mismatch'};
    return {ok:true};
  }
}

class DualVerifier {
  constructor({
    strictThreshold = 0.62,
    adversarialThreshold = 0.62,
    minEvidenceCoverage = 1,
    requireEvidenceRefs = true,
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
    if (!claim) return {ok:false, reason:'claim_required'};
    if (!Array.isArray(evidence) || evidence.length === 0) return {ok:false, reason:'evidence_required'};
    const ids = evidence.map(e => e && e.id);
    if (new Set(ids).size !== ids.length) return {ok:false, reason:'duplicate_evidence_id'};

    const strict = this.strictVerifier.verify({ claim, evidence, checks:strictChecks });
    if (strict.reason && ['invalid_evidence_binding','invalid_evidence_id','incomplete_evidence_binding','evidence_id_binding_mismatch'].includes(strict.reason)) {
      return {ok:false, reason:strict.reason, strict, adversarial:null};
    }
    const adversarial = this.adversarialVerifier.verify({ claim, evidence, checks:adversarialChecks });
    if (adversarial.reason && ['invalid_evidence_binding','invalid_evidence_id','incomplete_evidence_binding','evidence_id_binding_mismatch'].includes(adversarial.reason)) {
      return {ok:false, reason:adversarial.reason, strict, adversarial};
    }

    const evidenceCoverage = Math.min(strict.coverage || 0, adversarial.coverage || 0);
    const ok = strict.ok === true && adversarial.ok === true;
    return {
      ok,
      claim,
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
        distinctEngineIds:true
      },
      reason: ok
        ? 'dual_verifier_pass'
        : ((strict.reason || '').includes('coverage') || (adversarial.reason || '').includes('coverage')
          ? 'evidence_coverage_reject'
          : 'dual_verifier_reject')
    };
  }
}

module.exports = { StrictEvidenceVerifier, AdversarialEvidenceVerifier, DualVerifier };
