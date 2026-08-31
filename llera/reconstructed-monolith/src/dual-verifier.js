'use strict';

const { evidenceId } = require('./evidence-ledger');

class DualVerifier {
  constructor({
    strictThreshold = 0.62,
    adversarialThreshold = 0.62,
    minEvidenceCoverage = 1,
    requireEvidenceRefs = true
  } = {}) {
    this.strictThreshold = strictThreshold;
    this.adversarialThreshold = adversarialThreshold;
    this.minEvidenceCoverage = minEvidenceCoverage;
    this.requireEvidenceRefs = requireEvidenceRefs;
  }

  verify({claim, evidence = [], strictChecks = [], adversarialChecks = []}) {
    if (!claim) return {ok:false, reason:'claim_required'};
    if (!Array.isArray(evidence) || evidence.length === 0) return {ok:false, reason:'evidence_required'};

    const validation = evidence.map(e => this.#validateEvidence(e));
    const invalid = validation.find(v => !v.ok);
    if (invalid) return {ok:false, reason:invalid.reason};

    const missionIds = [...new Set(evidence.map(e => e.missionId))];
    if (missionIds.length !== 1) {
      return {ok:false, reason:'mixed_mission_evidence_reject', missionIds};
    }

    const ids = evidence.map(e => e.id);
    if (new Set(ids).size !== ids.length) return {ok:false, reason:'duplicate_evidence_id'};

    const knownIds = new Set(ids);
    const strict = this.#score(strictChecks, knownIds);
    const adversarial = this.#score(adversarialChecks, knownIds);
    const independence = this.#independence(strictChecks, adversarialChecks);
    const strictCoverage = this.#coverage(strict.checks, knownIds);
    const adversarialCoverage = this.#coverage(adversarial.checks, knownIds);
    const evidenceCoverage = Math.min(strictCoverage, adversarialCoverage);

    const coverageOk =
      strictCoverage >= this.minEvidenceCoverage &&
      adversarialCoverage >= this.minEvidenceCoverage;

    const ok =
      independence.ok &&
      coverageOk &&
      strict.score >= this.strictThreshold &&
      adversarial.score >= this.adversarialThreshold;

    return {
      ok,
      claim,
      missionId: missionIds[0],
      strict,
      adversarial,
      independence,
      evidenceCoverage,
      coverage: {
        strict: strictCoverage,
        adversarial: adversarialCoverage,
        required: this.minEvidenceCoverage
      },
      evidenceIds: ids,
      reason: ok
        ? 'dual_verifier_pass'
        : (!independence.ok
          ? 'verifier_independence_reject'
          : (!coverageOk ? 'evidence_coverage_reject' : 'dual_verifier_reject'))
    };
  }

  #validateEvidence(e) {
    if (!e || typeof e !== 'object') return {ok:false, reason:'invalid_evidence_binding'};
    if (!e.id || !/^ev_[a-f0-9]{24}$/i.test(e.id)) return {ok:false, reason:'invalid_evidence_id'};
    if (!/^[a-f0-9]{64}$/i.test(e.sha256 || '')) return {ok:false, reason:'invalid_evidence_binding'};
    if (!e.missionId || !e.stepId || !e.kind || !e.target) return {ok:false, reason:'incomplete_evidence_binding'};
    if (e.tool !== null && e.tool !== undefined && (typeof e.tool !== 'string' || !e.tool.trim())) {
      return {ok:false, reason:'invalid_evidence_tool'};
    }
    if (e.byteCount !== null && e.byteCount !== undefined && (!Number.isSafeInteger(e.byteCount) || e.byteCount < 0)) {
      return {ok:false, reason:'invalid_evidence_byte_count'};
    }

    const expected = evidenceId({
      missionId:e.missionId,
      stepId:e.stepId,
      tool:e.tool || null,
      kind:e.kind,
      target:e.target,
      sha256:String(e.sha256).toLowerCase()
    });
    if (expected !== e.id) return {ok:false, reason:'evidence_id_binding_mismatch'};
    return {ok:true};
  }

  #score(checks, knownIds) {
    if (!Array.isArray(checks) || checks.length === 0) {
      return {score:0, passed:0, total:0, failures:['no_checks'], checks:[]};
    }

    const normalized = checks.map((c, i) => {
      const refs = Array.isArray(c && c.evidenceIds)
        ? [...new Set(c.evidenceIds.filter(Boolean).map(String))]
        : [];
      const unknownEvidenceIds = refs.filter(id => !knownIds.has(id));
      const missingEvidenceRefs = this.requireEvidenceRefs && refs.length === 0;
      const bindingOk = !missingEvidenceRefs && unknownEvidenceIds.length === 0;
      const declaredOk = Boolean(c && c.ok);

      return {
        name: c && c.name ? c.name : `check_${i+1}`,
        ok: declaredOk && bindingOk,
        declaredOk,
        weight: Number.isFinite(c && c.weight) && c.weight > 0 ? c.weight : 1,
        detail: c && c.detail ? String(c.detail) : '',
        evidenceIds: refs,
        unknownEvidenceIds,
        bindingOk
      };
    });

    const totalWeight = normalized.reduce((s, c) => s + c.weight, 0);
    const passedWeight = normalized.filter(c => c.ok).reduce((s, c) => s + c.weight, 0);
    return {
      score: totalWeight ? passedWeight / totalWeight : 0,
      passed: normalized.filter(c => c.ok).length,
      total: normalized.length,
      failures: normalized.filter(c => !c.ok).map(c => c.name),
      checks: normalized
    };
  }

  #independence(strictChecks, adversarialChecks) {
    if (!Array.isArray(strictChecks) || !Array.isArray(adversarialChecks)) {
      return {ok:false, reason:'invalid_check_sets'};
    }
    if (strictChecks.length === 0 || adversarialChecks.length === 0) {
      return {ok:false, reason:'missing_verifier_channel'};
    }
    if (strictChecks === adversarialChecks) {
      return {ok:false, reason:'shared_check_array'};
    }

    const strictObjects = new Set(strictChecks.filter(c => c && typeof c === 'object'));
    const sharedObjects = adversarialChecks.filter(c => c && typeof c === 'object' && strictObjects.has(c));
    if (sharedObjects.length > 0) {
      return {ok:false, reason:'shared_check_object', sharedCount:sharedObjects.length};
    }

    const signature = c => JSON.stringify({
      name: c && c.name ? String(c.name) : '',
      detail: c && c.detail ? String(c.detail) : '',
      evidenceIds: Array.isArray(c && c.evidenceIds)
        ? [...new Set(c.evidenceIds.filter(Boolean).map(String))].sort()
        : []
    });
    const strictSignatures = new Set(strictChecks.map(signature));
    const adversarialSignatures = new Set(adversarialChecks.map(signature));
    const sharedSignatures = [...strictSignatures].filter(sig => adversarialSignatures.has(sig));
    if (sharedSignatures.length > 0) {
      return {
        ok:false,
        reason:'overlapping_verifier_checks',
        sharedCount:sharedSignatures.length
      };
    }

    return {ok:true, reason:'independent_verifier_channels'};
  }

  #coverage(checks, knownIds) {
    if (knownIds.size === 0) return 0;
    const referenced = new Set();
    for (const check of checks || []) {
      if (!check.ok) continue;
      for (const id of check.evidenceIds || []) {
        if (knownIds.has(id)) referenced.add(id);
      }
    }
    return referenced.size / knownIds.size;
  }
}

module.exports = { DualVerifier };
