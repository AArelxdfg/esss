'use strict';

class DualVerifier {
  constructor({strictThreshold = 0.62, adversarialThreshold = 0.62} = {}) {
    this.strictThreshold = strictThreshold;
    this.adversarialThreshold = adversarialThreshold;
  }

  verify({claim, evidence = [], strictChecks = [], adversarialChecks = []}) {
    if (!claim) return {ok:false, reason:'claim_required'};
    if (!Array.isArray(evidence) || evidence.length === 0) return {ok:false, reason:'evidence_required'};

    const validEvidence = evidence.filter(e => e && e.id && /^[a-f0-9]{64}$/i.test(e.sha256 || '') && e.target);
    if (validEvidence.length !== evidence.length) return {ok:false, reason:'invalid_evidence_binding'};

    const strict = this.#score(strictChecks);
    const adversarial = this.#score(adversarialChecks);
    const evidenceCoverage = validEvidence.length / evidence.length;
    const ok = strict.score >= this.strictThreshold && adversarial.score >= this.adversarialThreshold && evidenceCoverage === 1;

    return {
      ok,
      claim,
      strict,
      adversarial,
      evidenceCoverage,
      evidenceIds: validEvidence.map(e => e.id),
      reason: ok ? 'dual_verifier_pass' : 'dual_verifier_reject'
    };
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
