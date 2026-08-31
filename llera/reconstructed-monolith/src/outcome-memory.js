'use strict';

const crypto = require('crypto');
const { receiptStateKey } = require('./verified-mission-finalizer');

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function normalizeTokens(value) {
  return new Set(String(value || '').toLowerCase().match(/[a-z0-9_\-]{2,}/g) || []);
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}
function stableId(prefix, seed) {
  return `${prefix}_${crypto.createHash('sha256').update(String(seed)).digest('hex').slice(0, 20)}`;
}
function normalizeEvidenceIds(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter(Boolean).map(v => String(v)))];
}
function sameStringSet(a, b) {
  const aa = [...new Set((a || []).map(String))].sort();
  const bb = [...new Set((b || []).map(String))].sort();
  return aa.length === bb.length && aa.every((value, index) => value === bb[index]);
}
function validateFinalizationReceipt(receipt, { missionId, evidenceIds = [] } = {}) {
  if (!receipt || receipt.schema !== 2) return {ok:false, reason:'finalization_receipt_required'};
  if (receipt.missionId !== missionId) return {ok:false, reason:'finalization_receipt_mission_mismatch'};
  if (!/^[a-f0-9]{64}$/i.test(String(receipt.sha256 || '')) || receipt.sha256 !== receipt.stateKey) {
    return {ok:false, reason:'finalization_receipt_sha_invalid'};
  }
  if (!/^[a-f0-9]{64}$/i.test(String(receipt.toolTraceDigest || ''))) {
    return {ok:false, reason:'finalization_receipt_trace_digest_invalid'};
  }
  const receiptEvidenceIds = normalizeEvidenceIds(receipt.evidenceIds);
  if (!receiptEvidenceIds.length || !sameStringSet(receiptEvidenceIds, evidenceIds)) {
    return {ok:false, reason:'finalization_receipt_evidence_mismatch'};
  }
  const strictScore = Number(receipt.strictScore || 0);
  const adversarialScore = Number(receipt.adversarialScore || 0);
  if (!Number.isFinite(strictScore) || !Number.isFinite(adversarialScore) || strictScore < 0.62 || adversarialScore < 0.62) {
    return {ok:false, reason:'finalization_receipt_score_reject'};
  }
  const expected = receiptStateKey({
    missionId:receipt.missionId,
    claim:receipt.claim || '',
    evidenceIds:receiptEvidenceIds,
    materialBindings:Array.isArray(receipt.materialBindings) ? receipt.materialBindings : [],
    strictScore,
    adversarialScore,
    toolTraceDigest:receipt.toolTraceDigest
  });
  if (expected !== receipt.stateKey) return {ok:false, reason:'finalization_receipt_state_mismatch'};
  return {ok:true, strictScore, adversarialScore, confidence:Math.min(strictScore, adversarialScore), evidenceIds:receiptEvidenceIds, receiptSha256:receipt.sha256};
}

class OutcomeMemory {
  constructor({ load, save, now = () => Date.now() } = {}) {
    if (typeof load !== 'function' || typeof save !== 'function') throw new Error('load/save persistence functions are required');
    this.loadBackend = load;
    this.saveBackend = save;
    this.now = now;
    this.state = { schema: 1, outcomes: [], skillCandidates: [] };
    this.loaded = false;
    this.mutationQueue = Promise.resolve();
  }

  async init() {
    if (this.loaded) return this.snapshot();
    const persisted = await this.loadBackend();
    if (persisted) {
      if (persisted.schema !== 1 || !Array.isArray(persisted.outcomes) || !Array.isArray(persisted.skillCandidates)) {
        throw new Error('unsupported or corrupt outcome memory state');
      }
      this.state = clone(persisted);
    }
    this.loaded = true;
    return this.snapshot();
  }

  snapshot() { return clone(this.state); }

  async recordOutcome({ missionId, goal, status, summary = '', failurePattern = null, tags = [], verification = {} } = {}) {
    return this._exclusive(async () => {
    this._requireLoaded();
    if (!missionId || !goal) throw new Error('missionId and goal are required');
    if (!['completed', 'failed', 'partial'].includes(status)) throw new Error('invalid outcome status');

    const suppliedEvidenceIds = normalizeEvidenceIds(verification.evidenceIds);
    const receiptValidation = status === 'completed'
      ? validateFinalizationReceipt(verification.receipt, { missionId, evidenceIds:suppliedEvidenceIds })
      : {ok:false, reason:'non_completed_outcome'};
    const attemptedVerifiedCompletion = status === 'completed' && (
      verification.strict === true || verification.adversarial === true || Number(verification.confidence || 0) >= 0.62 || suppliedEvidenceIds.length > 0 || verification.receipt
    );
    if (attemptedVerifiedCompletion && !receiptValidation.ok) {
      const error = new Error(`verified completed outcome rejected: ${receiptValidation.reason}`);
      error.code = 'OUTCOME_VERIFICATION_RECEIPT_INVALID';
      error.reason = receiptValidation.reason;
      throw error;
    }

    const verified = status === 'completed' && receiptValidation.ok;
    const verificationEvidenceIds = verified ? receiptValidation.evidenceIds : suppliedEvidenceIds;
    const strict = verified ? true : verification.strict === true;
    const adversarial = verified ? true : verification.adversarial === true;
    const confidence = verified ? receiptValidation.confidence : Number(verification.confidence || 0);

    const at = this.now();
    const record = {
      id: stableId('outcome', `${missionId}:${at}:${goal}:${status}`),
      missionId,
      goal,
      status,
      summary,
      failurePattern: failurePattern ? String(failurePattern) : null,
      tags: [...new Set(tags.map(v => String(v).toLowerCase()))],
      verified,
      verification: {
        strict,
        adversarial,
        confidence,
        evidenceIds: verificationEvidenceIds,
        receiptSha256: verified ? receiptValidation.receiptSha256 : null
      },
      at
    };
    this.state.outcomes.push(record);
    await this._persist();
    return clone(record);
    });
  }

  search(query, { limit = 8, failuresOnly = false, verifiedOnly = false } = {}) {
    this._requireLoaded();
    const q = normalizeTokens(query);
    return this.state.outcomes
      .filter(o => (!failuresOnly || o.status === 'failed' || o.failurePattern) && (!verifiedOnly || o.verified))
      .map(o => {
        const corpus = normalizeTokens([o.goal, o.summary, o.failurePattern, ...o.tags].filter(Boolean).join(' '));
        const similarity = jaccard(q, corpus);
        const failureBoost = o.failurePattern && [...q].some(t => normalizeTokens(o.failurePattern).has(t)) ? 0.15 : 0;
        return { ...clone(o), similarity: Math.min(1, similarity + failureBoost) };
      })
      .filter(o => o.similarity > 0)
      .sort((a, b) => b.similarity - a.similarity || b.at - a.at)
      .slice(0, Math.max(1, limit));
  }

  recallFailurePatterns(query, { limit = 5 } = {}) {
    return this.search(query, { limit: Math.max(limit * 2, limit), failuresOnly: true })
      .filter(o => o.failurePattern).slice(0, limit)
      .map(o => ({ outcomeId: o.id, missionId: o.missionId, pattern: o.failurePattern, similarity: o.similarity }));
  }

  adaptiveBudget(goal, base = {}) {
    this._requireLoaded();
    const related = this.search(goal, { limit: 12 });
    const failures = related.filter(o => o.status === 'failed').length;
    const successes = related.filter(o => o.status === 'completed' && o.verified).length;
    const maxAttemptsPerStep = Math.min(6, Math.max(2, Number(base.maxAttemptsPerStep || 3) + (failures > successes ? 1 : 0)));
    const verificationReserve = Math.min(4, Math.max(1, Number(base.verificationReserve || 1) + (failures >= 2 ? 1 : 0)));
    return { ...base, maxAttemptsPerStep, verificationReserve, priorRelated: related.length, priorFailures: failures, priorVerifiedSuccesses: successes };
  }

  async proposeSkill({ missionId, sourceOutcomeId = null, name, description, procedure, evidenceIds = [], verification = {} } = {}) {
    return this._exclusive(async () => {
    this._requireLoaded();
    if (!missionId || !name || !description || !Array.isArray(procedure) || procedure.length === 0) {
      throw new Error('missionId/name/description/procedure are required');
    }

    const sourceOutcome = sourceOutcomeId
      ? this.state.outcomes.find(o => o && o.id === sourceOutcomeId)
      : [...this.state.outcomes].reverse().find(o => o.missionId === missionId);
    if (!sourceOutcome || sourceOutcome.missionId !== missionId || sourceOutcome.status !== 'completed' || !sourceOutcome.verified) {
      throw new Error('skill candidates require a verified completed mission outcome');
    }

    const sourceReceiptSha256 = sourceOutcome.verification && sourceOutcome.verification.receiptSha256;
    if (!sourceReceiptSha256 || verification.receiptSha256 !== sourceReceiptSha256) {
      throw new Error('skill candidate requires the source verified finalization receipt');
    }
    const verified =
      verification.strict === true &&
      verification.adversarial === true &&
      Number(verification.confidence || 0) >= 0.62;
    if (!verified) {
      throw new Error('skill candidate requires strict + adversarial verification at >=0.62 confidence');
    }

    const candidateEvidenceIds = normalizeEvidenceIds(evidenceIds);
    if (!candidateEvidenceIds.length) throw new Error('skill candidate requires bound evidence');

    const sourceEvidenceIds = normalizeEvidenceIds(sourceOutcome.verification && sourceOutcome.verification.evidenceIds);
    if (!sourceEvidenceIds.length) {
      throw new Error('verified source outcome has no persisted evidence provenance');
    }

    const sourceEvidence = new Set(sourceEvidenceIds);
    const foreignEvidenceIds = candidateEvidenceIds.filter(id => !sourceEvidence.has(id));
    if (foreignEvidenceIds.length) {
      throw new Error(`skill candidate evidence is not derived from source outcome: ${foreignEvidenceIds.join(',')}`);
    }

    const verifierEvidenceIds = normalizeEvidenceIds(verification.evidenceIds);
    if (verifierEvidenceIds.length) {
      const verifierEvidence = new Set(verifierEvidenceIds);
      const unverifiedCandidateEvidence = candidateEvidenceIds.filter(id => !verifierEvidence.has(id));
      if (unverifiedCandidateEvidence.length) {
        throw new Error(`skill candidate evidence was not covered by skill verification: ${unverifiedCandidateEvidence.join(',')}`);
      }
    }

    const at = this.now();
    const candidate = {
      id: stableId('skill_candidate', `${missionId}:${name}:${at}`),
      missionId,
      name,
      description,
      procedure: clone(procedure),
      evidenceIds: candidateEvidenceIds,
      sourceOutcomeId: sourceOutcome.id,
      sourceEvidenceIds,
      sourceReceiptSha256,
      trust: 'candidate-only',
      executable: false,
      approvalRequired: true,
      verificationConfidence: Number(verification.confidence),
      at
    };
    this.state.skillCandidates.push(candidate);
    await this._persist();
    return clone(candidate);
    });
  }

  _requireLoaded() { if (!this.loaded) throw new Error('outcome memory is not initialized'); }
  async _persist() { await this.saveBackend(clone(this.state)); }
  async _exclusive(operation) {
    const run = this.mutationQueue.then(async () => {
      const before = clone(this.state);
      try {
        return await operation();
      } catch (error) {
        this.state = before;
        throw error;
      }
    });
    this.mutationQueue = run.catch(() => {});
    return run;
  }
}

module.exports = { OutcomeMemory, validateFinalizationReceipt };