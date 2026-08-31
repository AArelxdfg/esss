'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LEDGER_SCHEMA = 2;
const SUMMARY_MAX_CHARS = 512;

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

function evidenceBindingSeal({missionId, stepId, tool, kind, target, sha256: digest, byteCount}) {
  return sha256(JSON.stringify(canonical({
    missionId,
    stepId,
    tool,
    kind,
    target,
    sha256: String(digest || '').toLowerCase(),
    byteCount
  })));
}

function ledgerSeal({schema = LEDGER_SCHEMA, missionId, entries = []}) {
  return sha256(JSON.stringify(canonical({schema, missionId, entries})));
}

function byteLength(value) {
  if (Buffer.isBuffer(value)) return value.length;
  if (value instanceof Uint8Array) return value.byteLength;
  return Buffer.byteLength(String(value), 'utf8');
}

function boundedSummary(value) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length <= SUMMARY_MAX_CHARS ? text : `${text.slice(0, SUMMARY_MAX_CHARS - 1)}…`;
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

class EvidenceLedger {
  constructor({missionId, storagePath = null}) {
    if (!missionId) throw new Error('missionId required');
    this.missionId = missionId;
    this.storagePath = storagePath ? path.resolve(storagePath) : null;
    this.entries = [];
    if (this.storagePath) this.#loadPersistent();
  }

  add({stepId, tool = 'unknown', kind, target, bytes, digest, metadata = {}, summary = null, observedAt = new Date().toISOString()}) {
    if (!stepId || !kind || !target) throw new Error('stepId, kind and target required');
    const normalizedTool = String(tool || 'unknown').trim() || 'unknown';
    const computed = bytes === undefined ? null : sha256(bytes);
    const boundDigest = digest || computed;
    if (!boundDigest || !/^[a-f0-9]{64}$/i.test(boundDigest)) throw new Error('valid sha256 required');
    if (computed && digest && computed.toLowerCase() !== digest.toLowerCase()) throw new Error('evidence digest mismatch');

    const normalizedMetadata = canonical(metadata || {});
    const byteCount = bytes === undefined
      ? (Number.isInteger(normalizedMetadata.byteCount) && normalizedMetadata.byteCount >= 0 ? normalizedMetadata.byteCount : 0)
      : byteLength(bytes);
    const bounded = boundedSummary(summary ?? normalizedMetadata.summary ?? normalizedMetadata.message ?? '');
    const normalizedDigest = boundDigest.toLowerCase();
    const id = evidenceId({missionId:this.missionId, stepId, target, sha256:normalizedDigest, kind});
    const bindingSha256 = evidenceBindingSeal({
      missionId:this.missionId,
      stepId,
      tool:normalizedTool,
      kind,
      target,
      sha256:normalizedDigest,
      byteCount
    });

    const entry = {
      id,
      missionId: this.missionId,
      stepId,
      tool: normalizedTool,
      kind,
      target,
      sha256: normalizedDigest,
      byteCount,
      summary: bounded,
      bindingSha256,
      metadata: normalizedMetadata,
      observedAt
    };
    const existing = this.entries.find(x => x.id === entry.id);
    if (existing) return clone(existing);

    const next = [...this.entries, entry];
    if (this.storagePath) this.#persist(next);
    this.entries = next;
    return clone(entry);
  }

  verifyBinding(id, {target, bytes, digest} = {}) {
    const entry = this.entries.find(x => x.id === id);
    if (!entry) return {ok:false, reason:'evidence_not_found'};
    if (!target) return {ok:false, reason:'target_required'};
    if (target !== entry.target) return {ok:false, reason:'target_mismatch'};
    if (bytes === undefined) return {ok:false, reason:'bytes_required'};
    const actual = sha256(bytes);
    if (digest && (!/^[a-f0-9]{64}$/i.test(String(digest)) || String(digest).toLowerCase() !== actual)) {
      return {ok:false, reason:'digest_mismatch'};
    }
    if (actual !== entry.sha256) return {ok:false, reason:'sha256_mismatch'};
    if (Number.isInteger(entry.byteCount) && entry.byteCount !== byteLength(bytes)) return {ok:false, reason:'byte_count_mismatch'};
    if (entry.bindingSha256) {
      const expectedBinding = evidenceBindingSeal(entry);
      if (expectedBinding !== entry.bindingSha256) return {ok:false, reason:'binding_mismatch'};
    }
    return {ok:true, entry:clone(entry)};
  }

  forStep(stepId) { return this.entries.filter(x => x.stepId === stepId).map(clone); }
  snapshot() { return this.entries.map(x => clone({...x, metadata:canonical(x.metadata)})); }

  // Default export stays compatible with the AURORA view-model, which consumes
  // a plain evidence array. sealed=true produces a portable, integrity-bound
  // state object suitable for backup/restore and cross-process handoff.
  export({sealed = false} = {}) {
    const entries = this.snapshot();
    if (!sealed) return entries;
    const state = {schema:LEDGER_SCHEMA, missionId:this.missionId, entries};
    state.stateSha256 = ledgerSeal(state);
    return clone(state);
  }

  // Import is fail-closed and atomic with respect to both memory and disk:
  // every binding is validated before the current ledger is touched; when a
  // storagePath exists, persistence succeeds before this.entries is replaced.
  import(state) {
    const parsed = clone(state);
    this.#assertState(parsed);
    const next = parsed.entries.map(entry => clone({...entry, metadata:canonical(entry.metadata || {})}));
    if (this.storagePath) this.#persist(next);
    this.entries = next;
    return this.snapshot();
  }

  #loadPersistent() {
    if (!fs.existsSync(this.storagePath)) return;
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
    } catch (error) {
      const wrapped = new Error(`evidence ledger store unreadable: ${String(error && error.message || error)}`);
      wrapped.code = 'EVIDENCE_LEDGER_STORE_CORRUPT';
      throw wrapped;
    }
    this.#assertState(parsed);
    this.entries = parsed.entries.map(clone);
  }

  #assertState(parsed) {
    if (!parsed || parsed.schema !== LEDGER_SCHEMA || parsed.missionId !== this.missionId || !Array.isArray(parsed.entries) || !/^[a-f0-9]{64}$/i.test(parsed.stateSha256 || '')) {
      const error = new Error('evidence ledger store schema/mission invalid');
      error.code = 'EVIDENCE_LEDGER_STORE_INVALID';
      throw error;
    }
    const expectedSeal = ledgerSeal(parsed);
    if (expectedSeal !== String(parsed.stateSha256).toLowerCase()) {
      const error = new Error('evidence ledger store integrity mismatch');
      error.code = 'EVIDENCE_LEDGER_STORE_TAMPERED';
      throw error;
    }
    const seen = new Set();
    for (const entry of parsed.entries) {
      this.#assertEntry(entry);
      if (seen.has(entry.id)) {
        const error = new Error(`duplicate persisted evidence id: ${entry.id}`);
        error.code = 'EVIDENCE_LEDGER_STORE_DUPLICATE';
        throw error;
      }
      seen.add(entry.id);
    }
  }

  #assertEntry(entry) {
    if (!entry || entry.missionId !== this.missionId || !entry.stepId || !entry.kind || !entry.target || !/^[a-f0-9]{64}$/i.test(entry.sha256 || '')) {
      const error = new Error('persisted evidence binding invalid');
      error.code = 'EVIDENCE_LEDGER_ENTRY_INVALID';
      throw error;
    }
    const expectedId = evidenceId({
      missionId:entry.missionId,
      stepId:entry.stepId,
      target:entry.target,
      sha256:String(entry.sha256).toLowerCase(),
      kind:entry.kind
    });
    if (expectedId !== entry.id) {
      const error = new Error('persisted evidence id binding mismatch');
      error.code = 'EVIDENCE_LEDGER_ENTRY_TAMPERED';
      throw error;
    }

    // Legacy reconstructed entries remain loadable, but every newly enriched
    // record is additionally bound to tool identity and observed byte count.
    const hasEnrichedBinding = entry.tool !== undefined || entry.byteCount !== undefined || entry.bindingSha256 !== undefined;
    if (hasEnrichedBinding) {
      if (!entry.tool || !Number.isInteger(entry.byteCount) || entry.byteCount < 0 || !/^[a-f0-9]{64}$/i.test(entry.bindingSha256 || '')) {
        const error = new Error('persisted enriched evidence binding invalid');
        error.code = 'EVIDENCE_LEDGER_ENTRY_INVALID';
        throw error;
      }
      if (entry.summary !== undefined && String(entry.summary).length > SUMMARY_MAX_CHARS) {
        const error = new Error('persisted evidence summary exceeds bound');
        error.code = 'EVIDENCE_LEDGER_ENTRY_INVALID';
        throw error;
      }
      const expectedBinding = evidenceBindingSeal(entry);
      if (expectedBinding !== String(entry.bindingSha256).toLowerCase()) {
        const error = new Error('persisted evidence tool/byte binding mismatch');
        error.code = 'EVIDENCE_LEDGER_ENTRY_TAMPERED';
        throw error;
      }
    }
  }

  #persist(entries) {
    for (const entry of entries) this.#assertEntry(entry);
    const state = { schema:LEDGER_SCHEMA, missionId:this.missionId, entries:entries.map(clone) };
    state.stateSha256 = ledgerSeal(state);
    fs.mkdirSync(path.dirname(this.storagePath), {recursive:true});
    const tmp = `${this.storagePath}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    try {
      fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, {encoding:'utf8', mode:0o600, flag:'wx'});
      fs.renameSync(tmp, this.storagePath);
    } catch (error) {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
      const wrapped = new Error(`evidence ledger persistence failed: ${String(error && error.message || error)}`);
      wrapped.code = 'EVIDENCE_LEDGER_PERSIST_FAILED';
      throw wrapped;
    }
  }
}

module.exports = {
  LEDGER_SCHEMA,
  SUMMARY_MAX_CHARS,
  sha256,
  evidenceId,
  evidenceBindingSeal,
  ledgerSeal,
  boundedSummary,
  EvidenceLedger
};
