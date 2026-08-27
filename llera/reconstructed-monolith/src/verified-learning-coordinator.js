'use strict';

class VerifiedLearningCoordinator {
  constructor({ finalizer, outcomeMemory, loadState, saveState, deriveSkill = null } = {}) {
    if (!finalizer || typeof finalizer.finalize !== 'function') throw new Error('finalizer.finalize is required');
    if (!outcomeMemory || typeof outcomeMemory.recordOutcome !== 'function' || typeof outcomeMemory.snapshot !== 'function') {
      throw new Error('outcomeMemory recordOutcome/snapshot is required');
    }
    if (typeof loadState !== 'function' || typeof saveState !== 'function') throw new Error('loadState/saveState are required');
    if (deriveSkill != null && typeof deriveSkill !== 'function') throw new Error('deriveSkill must be a function');
    this.finalizer = finalizer;
    this.outcomeMemory = outcomeMemory;
    this.loadState = loadState;
    this.saveState = saveState;
    this.deriveSkill = deriveSkill;
    this.state = { schema: 1, receipts: {} };
    this.loaded = false;
  }

  async init() {
    if (this.loaded) return this.snapshot();
    const persisted = await this.loadState();
    if (persisted) {
      if (persisted.schema !== 1 || !persisted.receipts || typeof persisted.receipts !== 'object') {
        throw new Error('corrupt verified learning state');
      }
      this.state = JSON.parse(JSON.stringify(persisted));
    }
    this.loaded = true;
    return this.snapshot();
  }

  snapshot() { return JSON.parse(JSON.stringify(this.state)); }

  async finalizeAndLearn({ missionId, goal, claim, summary = '', tags = [], strictChecks = [], adversarialChecks = [], skill = null } = {}) {
    if (!this.loaded) throw new Error('verified learning coordinator is not initialized');
    if (!missionId || !goal) return { ok: false, learned: false, reason: 'mission_id_and_goal_required' };

    const finalization = await this.finalizer.finalize({ missionId, claim, strictChecks, adversarialChecks });
    if (!finalization || !finalization.ok || !finalization.publishable) {
      return { ok: false, learned: false, reason: finalization && finalization.reason || 'verified_finalization_required', finalization };
    }

    const receipt = finalization.receipt || {};
    if (!isSha256(receipt.sha256)) throw new Error('verified finalization receipt SHA-256 required');
    const verification = finalization.verification || {};
    const strictScore = Number(verification.strict && verification.strict.score || receipt.strictScore || 0);
    const adversarialScore = Number(verification.adversarial && verification.adversarial.score || receipt.adversarialScore || 0);
    const confidence = Math.min(strictScore, adversarialScore);
    if (strictScore < 0.62 || adversarialScore < 0.62) throw new Error('verifier score below learning threshold');

    const evidenceIds = Array.isArray(verification.evidenceIds) ? verification.evidenceIds : (Array.isArray(receipt.evidenceIds) ? receipt.evidenceIds : []);
    if (!evidenceIds.length) throw new Error('bound evidence IDs required for learning');

    const tag = `final-receipt:${receipt.sha256}`;
    const existing = findOutcomeByReceipt(this.outcomeMemory.snapshot(), tag);
    if (existing) {
      this.state.receipts[receipt.sha256] = { status: 'committed', missionId, outcomeId: existing.id || null };
      await this.saveState(this.snapshot());
      return { ok: true, learned: false, idempotent: true, receiptSha256: receipt.sha256, outcome: existing };
    }

    this.state.receipts[receipt.sha256] = { status: 'applying', missionId };
    await this.saveState(this.snapshot());

    const verifiedContext = { strict: true, adversarial: true, confidence, evidenceIds };
    const outcome = await this.outcomeMemory.recordOutcome({
      missionId, goal, status: 'completed', summary,
      tags: [...new Set([...tags, tag])], verification: verifiedContext
    });

    let skillCandidate = null;
    let proposal = skill;
    if (!proposal && this.deriveSkill) proposal = await this.deriveSkill({ missionId, goal, claim, summary, evidenceIds, receipt: { ...receipt } });
    if (proposal && typeof this.outcomeMemory.proposeSkill === 'function') {
      const current = this.outcomeMemory.snapshot();
      const duplicate = (current.skillCandidates || []).find(c => c && c.missionId === missionId && c.name === proposal.name && c.sourceOutcomeId === outcome.id);
      skillCandidate = duplicate || await this.outcomeMemory.proposeSkill({
        missionId, name: proposal.name, description: proposal.description, procedure: proposal.procedure,
        evidenceIds, verification: verifiedContext
      });
    }

    this.state.receipts[receipt.sha256] = { status: 'committed', missionId, outcomeId: outcome.id || null, skillCandidateId: skillCandidate && skillCandidate.id || null };
    await this.saveState(this.snapshot());
    return { ok: true, learned: true, idempotent: false, receiptSha256: receipt.sha256, outcome, skillCandidate };
  }
}

function findOutcomeByReceipt(snapshot, tag) {
  return ((snapshot && snapshot.outcomes) || []).find(o => o && Array.isArray(o.tags) && o.tags.includes(tag)) || null;
}
function isSha256(value) { return /^[a-f0-9]{64}$/i.test(String(value || '')); }
module.exports = { VerifiedLearningCoordinator, findOutcomeByReceipt };
