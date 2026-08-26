'use strict';

const crypto = require('crypto');

function sha256(value) {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return crypto.createHash('sha256').update(data).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = canonical(value[key]);
      return out;
    }, {});
  }
  return value;
}

function evidenceId({missionId, stepId, target, sha256: digest, kind}) {
  return `ev_${sha256(JSON.stringify(canonical({missionId, stepId, target, sha256:digest, kind}))).slice(0, 24)}`;
}

class EvidenceLedger {
  constructor({missionId}) {
    if (!missionId) throw new Error('missionId required');
    this.missionId = missionId;
    this.entries = [];
  }

  add({stepId, kind, target, bytes, digest, metadata = {}, observedAt = new Date().toISOString()}) {
    if (!stepId || !kind || !target) throw new Error('stepId, kind and target required');
    const computed = bytes === undefined ? null : sha256(bytes);
    const boundDigest = digest || computed;
    if (!boundDigest || !/^[a-f0-9]{64}$/i.test(boundDigest)) throw new Error('valid sha256 required');
    if (computed && digest && computed.toLowerCase() !== digest.toLowerCase()) throw new Error('evidence digest mismatch');

    const entry = {
      id: evidenceId({missionId:this.missionId, stepId, target, sha256:boundDigest.toLowerCase(), kind}),
      missionId: this.missionId,
      stepId,
      kind,
      target,
      sha256: boundDigest.toLowerCase(),
      metadata: canonical(metadata),
      observedAt
    };
    if (this.entries.some(x => x.id === entry.id)) return this.entries.find(x => x.id === entry.id);
    this.entries.push(entry);
    return entry;
  }

  verifyBinding(id, {target, bytes, digest}) {
    const entry = this.entries.find(x => x.id === id);
    if (!entry) return {ok:false, reason:'evidence_not_found'};
    if (target && target !== entry.target) return {ok:false, reason:'target_mismatch'};
    const actual = digest || (bytes === undefined ? null : sha256(bytes));
    if (!actual) return {ok:false, reason:'digest_missing'};
    if (actual.toLowerCase() !== entry.sha256) return {ok:false, reason:'sha256_mismatch'};
    return {ok:true, entry};
  }

  forStep(stepId) { return this.entries.filter(x => x.stepId === stepId); }
  snapshot() { return this.entries.map(x => ({...x, metadata:canonical(x.metadata)})); }
}

module.exports = { sha256, evidenceId, EvidenceLedger };
