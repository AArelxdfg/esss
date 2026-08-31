'use strict';

const crypto = require('crypto');

const MAX_SUMMARY_BYTES = 512;

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

function boundedSummary(value, maxBytes = MAX_SUMMARY_BYTES) {
  if (value === undefined || value === null) return '';
  const input = String(value);
  const bytes = Buffer.from(input, 'utf8');
  if (bytes.length <= maxBytes) return input;

  let end = maxBytes;
  while (end > 0) {
    const candidate = bytes.subarray(0, end).toString('utf8');
    if (!candidate.endsWith('\ufffd')) return candidate;
    end -= 1;
  }
  return '';
}

function evidenceId({missionId, stepId, tool = null, target, sha256: digest, kind}) {
  const binding = {missionId, stepId, target, sha256:digest, kind};
  if (tool) binding.tool = tool;
  return `ev_${sha256(JSON.stringify(canonical(binding))).slice(0, 24)}`;
}

class EvidenceLedger {
  constructor({missionId}) {
    if (!missionId) throw new Error('missionId required');
    this.missionId = missionId;
    this.entries = [];
  }

  add({stepId, tool = null, kind, target, bytes, digest, byteCount = null, summary = '', metadata = {}, observedAt = new Date().toISOString()}) {
    if (!stepId || !kind || !target) throw new Error('stepId, kind and target required');
    if (tool !== null && (typeof tool !== 'string' || !tool.trim())) throw new Error('tool must be a non-empty string when provided');

    const computed = bytes === undefined ? null : sha256(bytes);
    const boundDigest = digest || computed;
    if (!boundDigest || !/^[a-f0-9]{64}$/i.test(boundDigest)) throw new Error('valid sha256 required');
    if (computed && digest && computed.toLowerCase() !== digest.toLowerCase()) throw new Error('evidence digest mismatch');

    const computedByteCount = bytes === undefined
      ? null
      : (Buffer.isBuffer(bytes) ? bytes.length : Buffer.byteLength(String(bytes), 'utf8'));
    const normalizedByteCount = computedByteCount !== null ? computedByteCount : byteCount;
    if (normalizedByteCount !== null && (!Number.isSafeInteger(normalizedByteCount) || normalizedByteCount < 0)) {
      throw new Error('byteCount must be a non-negative safe integer');
    }
    if (computedByteCount !== null && byteCount !== null && byteCount !== computedByteCount) {
      throw new Error('evidence byteCount mismatch');
    }

    const normalizedTool = tool ? tool.trim() : null;
    const normalizedSummary = boundedSummary(summary || (metadata && metadata.summary) || '');
    const entry = {
      id: evidenceId({missionId:this.missionId, stepId, tool:normalizedTool, target, sha256:boundDigest.toLowerCase(), kind}),
      missionId: this.missionId,
      stepId,
      tool: normalizedTool,
      kind,
      target,
      sha256: boundDigest.toLowerCase(),
      byteCount: normalizedByteCount,
      summary: normalizedSummary,
      metadata: canonical(metadata),
      observedAt
    };
    if (this.entries.some(x => x.id === entry.id)) return this.entries.find(x => x.id === entry.id);
    this.entries.push(entry);
    return entry;
  }

  verifyBinding(id, {tool = null, target, bytes, digest, byteCount = null} = {}) {
    const entry = this.entries.find(x => x.id === id);
    if (!entry) return {ok:false, reason:'evidence_not_found'};
    if (typeof target !== 'string' || !target.trim()) return {ok:false, reason:'target_required'};
    if (target !== entry.target) return {ok:false, reason:'target_mismatch'};

    if (entry.tool) {
      if (typeof tool !== 'string' || !tool.trim()) return {ok:false, reason:'tool_required'};
      if (tool.trim() !== entry.tool) return {ok:false, reason:'tool_mismatch'};
    } else if (tool !== null && tool !== undefined && String(tool).trim()) {
      return {ok:false, reason:'tool_mismatch'};
    }

    const actual = digest || (bytes === undefined ? null : sha256(bytes));
    if (!actual) return {ok:false, reason:'digest_missing'};
    if (!/^[a-f0-9]{64}$/i.test(String(actual))) return {ok:false, reason:'digest_invalid'};
    if (String(actual).toLowerCase() !== entry.sha256) return {ok:false, reason:'sha256_mismatch'};

    const actualByteCount = bytes === undefined
      ? byteCount
      : (Buffer.isBuffer(bytes) ? bytes.length : Buffer.byteLength(String(bytes), 'utf8'));
    if (entry.byteCount !== null && actualByteCount !== null && actualByteCount !== entry.byteCount) {
      return {ok:false, reason:'byte_count_mismatch'};
    }
    return {ok:true, entry};
  }

  export() {
    return this.snapshot();
  }

  import(rawEntries) {
    if (!Array.isArray(rawEntries)) throw new Error('evidence import must be an array');
    const restored = [];
    const seen = new Set();

    for (const raw of rawEntries) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid evidence entry');
      if (raw.missionId !== this.missionId) throw new Error('evidence mission mismatch');
      if (!raw.id || typeof raw.id !== 'string') throw new Error('evidence id required');
      if (seen.has(raw.id)) throw new Error('duplicate evidence id');

      const expectedId = evidenceId({
        missionId: this.missionId,
        stepId: raw.stepId,
        tool: raw.tool || null,
        target: raw.target,
        sha256: String(raw.sha256 || '').toLowerCase(),
        kind: raw.kind
      });
      if (expectedId !== raw.id) throw new Error('evidence id binding mismatch');

      const entry = this.add({
        stepId: raw.stepId,
        tool: raw.tool || null,
        kind: raw.kind,
        target: raw.target,
        digest: raw.sha256,
        byteCount: raw.byteCount === undefined ? null : raw.byteCount,
        summary: raw.summary || '',
        metadata: raw.metadata || {},
        observedAt: raw.observedAt
      });
      if (entry.id !== raw.id) throw new Error('evidence import identity mismatch');
      seen.add(raw.id);
      restored.push(entry);
    }

    this.entries = restored.map(x => ({...x, metadata:canonical(x.metadata)}));
    return {restored:this.entries.length};
  }

  forStep(stepId) { return this.entries.filter(x => x.stepId === stepId); }
  snapshot() { return this.entries.map(x => ({...x, metadata:canonical(x.metadata)})); }
}

module.exports = { MAX_SUMMARY_BYTES, sha256, boundedSummary, evidenceId, EvidenceLedger };
