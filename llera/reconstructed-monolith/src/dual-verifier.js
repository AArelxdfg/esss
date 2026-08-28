'use strict';

const { evidenceId } = require('./evidence-ledger');

class DualVerifier {
  constructor({strictThreshold = 0.62, adversarialThreshold = 0.62} = {}) {
    this.strictThreshold = strictThreshold;
    this.adversarialThreshold = adversarialThreshold;
  }

  verify({claim, evidence = [], strictChecks = [], adversarialChecks = []}) {
    if (!claim) return {ok:false, reason:'claim_required'};
    if (!Array.isArray(evidence) || evidence.length === 0) return {ok:false, reason:'evidence_required'};

    const validation = evidence.map(e => this.#validateEvidence(e));
    const invalid = validation.find(v => !v.ok);
    if (invalid) return {ok:false, reason:invalid.reason};

    const ids = evidence.map(e => e.id);
    if (new Set(ids).size !== ids.length) return {ok:false, reason:'duplicate_evidence_id'};

    const strict = this.#score(strictChecks);
    const adversarial = this.#score(adversarialChecks);
    const evidenceCoverage = 1;
    const ok = strict.score >= this.strictThreshold && adversarial.score >= this.adversarialThreshold;

    return {
      ok,
      claim,
      strict,
      adversarial,
      evidenceCoverage,
      evidenceIds: ids,
      reason: ok ? 'dual_verifier_pass' : 'dual_verifier_reject'
    };
  }

  #validateEvidence(e) {
    if (!e || typeof e !== 'object') return {ok:false, reason:'invalid_evidence_binding'};
    if (!e.id || !/^ev_[a-f0-9]{24}$/i.test(e.id)) return {ok:false, reason:'invalid_evidence_id'};
    if (!/^[a-f0-9]{64}$/i.test(e.sha256 || '')) return {ok:false, reason:'invalid_evidence_binding'};
    if (!e.missionId || !e.stepId || !e.kind || !e.target) return {ok:false, reason:'incomplete_evidence_binding'};

    const expected = evidenceId({
      missionId:e.missionId,
      stepId:e.stepId,
      kind:e.kind,
      target:e.target,
      sha256:String(e.sha256).toLowerCase()
    });
    if (expected !== e.id) return {ok:false, reason:'evidence_id_binding_mismatch'};
    return {ok:true};
  }

  #score(checks) {
    if (!Array.isArray(checks) || checks.length === 0) return {score:0, passed:0, total:0, failures:['no_checks']};
    const normalized = checks.map((c, i) => ({
      name: c && c.name ? c.name : `check_${i+1}`,
      ok: Boolean(c && c.ok),
      weight: Number.isFinite(c && c.weight) && c.weight > 0 ? c.weight : 1,
      detail: c && c.detail ? String(c.detail) : ''
    }));
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
}

module.exports = { DualVerifier };
