'use strict';

const crypto = require('crypto');

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

class OutcomeMemory {
  constructor({ load, save, now = () => Date.now() } = {}) {
    if (typeof load !== 'function' || typeof save !== 'function') throw new Error('load/save persistence functions are required');
    this.loadBackend = load;
    this.saveBackend = save;
    this.now = now;
    this.state = { schema: 1, outcomes: [], skillCandidates: [] };
    this.durableState = clone(this.state);
    this.persistenceInFlight = false;
    this.loaded = false;
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
    this.durableState = clone(this.state);
    this.loaded = true;
    return this.snapshot();
  }

  snapshot() { return clone(this.state); }

  async recordOutcome({ missionId, goal, status, summary = '', failurePattern = null, tags = [], verification = {} } = {}) {
    this._requireLoaded();
    this._requirePersistenceIdle();
    if (!missionId || !goal) throw new Error('missionId and goal are required');
    if (!['completed', 'failed', 'partial'].includes(status)) throw new Error('invalid outcome status');

    const verificationEvidenceIds = normalizeEvidenceIds(verification.evidenceIds);
    const verified =
      verification.strict === true &&
      verification.adversarial === true &&
      Number(verification.confidence || 0) >= 0.62 &&
      verificationEvidenceIds.length > 0;

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
        strict: verification.strict === true,
        adversarial: verification.adversarial === true,
        confidence: Number(verification.confidence || 0),
        evidenceIds: verificationEvidenceIds
      },
      at
    };
    this.state.outcomes.push(record);
    await this._persist();
    return clone(record);
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

  async proposeSkill({ missionId, name, description, procedure, evidenceIds = [], verification = {} } = {}) {
    this._requireLoaded();
    this._requirePersistenceIdle();
    if (!missionId || !name || !description || !Array.isArray(procedure) || procedure.length === 0) {
      throw new Error('missionId/name/description/procedure are required');
    }

    const sourceOutcome = [...this.state.outcomes].reverse().find(o => o.missionId === missionId);
    if (!sourceOutcome || sourceOutcome.status !== 'completed' || !sourceOutcome.verified) {
      throw new Error('skill candidates require a verified completed mission outcome');
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
    if (!verifierEvidenceIds.length) {
      throw new Error('skill candidate verification requires explicit evidence coverage');
    }
    const verifierEvidence = new Set(verifierEvidenceIds);
    const unverifiedCandidateEvidence = candidateEvidenceIds.filter(id => !verifierEvidence.has(id));
    if (unverifiedCandidateEvidence.length) {
      throw new Error(`skill candidate evidence was not covered by skill verification: ${unverifiedCandidateEvidence.join(',')}`);
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
      trust: 'candidate-only',
      executable: false,
      approvalRequired: true,
      verificationConfidence: Number(verification.confidence),
      at
    };
    this.state.skillCandidates.push(candidate);
    await this._persist();
    return clone(candidate);
  }

  _requireLoaded() { if (!this.loaded) throw new Error('outcome memory is not initialized'); }
  _requirePersistenceIdle() {
    if (this.persistenceInFlight) {
      const error = new Error('outcome memory persistence transaction already in progress');
      error.code = 'OUTCOME_MEMORY_PERSISTENCE_IN_PROGRESS';
      throw error;
    }
  }
  async _persist() {
    this._requirePersistenceIdle();
    this.persistenceInFlight = true;
    try {
      const candidate = clone(this.state);
      await this.saveBackend(candidate);
      this.durableState = clone(candidate);
    } catch (error) {
      this.state = clone(this.durableState);
      throw error;
    } finally {
      this.persistenceInFlight = false;
    }
  }
}

module.exports = { OutcomeMemory };
