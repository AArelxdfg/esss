'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LEDGER_SCHEMA = 2;

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

function ledgerSeal({schema = LEDGER_SCHEMA, missionId, entries = []}) {
  return sha256(JSON.stringify(canonical({schema, missionId, entries})));
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
    const existing = this.entries.find(x => x.id === entry.id);
    if (existing) return existing;

    const next = [...this.entries, entry];
    if (this.storagePath) this.#persist(next);
    this.entries = next;
    return clone(entry);
  }

  verifyBinding(id, {target, bytes, digest}) {
    const entry = this.entries.find(x => x.id === id);
    if (!entry) return {ok:false, reason:'evidence_not_found'};
    if (target && target !== entry.target) return {ok:false, reason:'target_mismatch'};
    const actual = digest || (bytes === undefined ? null : sha256(bytes));
    if (!actual) return {ok:false, reason:'digest_missing'};
    if (actual.toLowerCase() !== entry.sha256) return {ok:false, reason:'sha256_mismatch'};
    return {ok:true, entry:clone(entry)};
  }

  forStep(stepId) { return this.entries.filter(x => x.stepId === stepId).map(clone); }
  snapshot() { return this.entries.map(x => clone({...x, metadata:canonical(x.metadata)})); }

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
    this.entries = parsed.entries.map(clone);
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

module.exports = { LEDGER_SCHEMA, sha256, evidenceId, ledgerSeal, EvidenceLedger };
