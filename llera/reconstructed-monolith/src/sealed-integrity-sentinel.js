'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const VERSION = 2;
function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
}
function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : stable(value));
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding:'utf8', mode:0o600 });
  fs.renameSync(tmp, file);
}
function norm(p) {
  const out = String(p || '').trim().replace(/\\/g, '/');
  return process.platform === 'win32' ? out.toLowerCase() : out;
}
function baselineSeal(entry) {
  const payload = { ...entry };
  delete payload.integritySha256;
  return sha256(payload);
}
function incidentSeal(entry) {
  const payload = { ...entry };
  delete payload.integritySha256;
  return sha256(payload);
}
function stateSeal(state) {
  return sha256({
    version: state.version,
    baselines: state.baselines,
    incidents: state.incidents,
    quarantine: state.quarantine,
  });
}

class SealedIntegritySentinel {
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.readFile = options.readFile || (p => fs.readFileSync(p));
    this.exists = options.exists || (p => fs.existsSync(p));
    this.now = options.now || (() => new Date().toISOString());
    this.state = { version: VERSION, baselines:{}, incidents:[], quarantine:{}, stateSha256:null };
    this.load();
  }

  load() {
    if (!fs.existsSync(this.filePath)) return;
    const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    if (!parsed || parsed.version !== VERSION || !parsed.baselines || !Array.isArray(parsed.incidents) || !parsed.quarantine) {
      throw new Error('SEALED_INTEGRITY_STORE_SCHEMA_INVALID');
    }
    for (const [target, entry] of Object.entries(parsed.baselines)) {
      if (!entry || entry.target !== target || !entry.integritySha256 || baselineSeal(entry) !== entry.integritySha256) {
        throw new Error('SEALED_BASELINE_TAMPERED');
      }
    }
    let previous = null;
    for (const incident of parsed.incidents) {
      if (!incident.integritySha256 || incidentSeal(incident) !== incident.integritySha256) throw new Error('SEALED_INCIDENT_TAMPERED');
      if (incident.previousIncidentSha256 !== previous) throw new Error('SEALED_INCIDENT_CHAIN_BROKEN');
      previous = incident.integritySha256;
    }
    if (!parsed.stateSha256 || stateSeal(parsed) !== parsed.stateSha256) throw new Error('SEALED_STATE_TAMPERED');
    this.state = parsed;
  }

  baseline(targetPath, metadata = {}) {
    if (!this.exists(targetPath)) throw new Error('SEALED_BASELINE_TARGET_MISSING');
    const target = norm(targetPath);
    const entry = {
      target,
      sha256: sha256(this.readFile(targetPath)),
      role: String(metadata.role || 'protected'),
      createdAt: this.now(),
    };
    entry.integritySha256 = baselineSeal(entry);
    this.state.baselines[target] = entry;
    this.persist();
    return { ...entry };
  }

  check(targetPath) {
    const target = norm(targetPath);
    const baseline = this.state.baselines[target];
    if (!baseline) throw new Error('SEALED_BASELINE_MISSING');
    if (!this.exists(targetPath)) return this.raiseIncident(target, baseline.sha256, null, 'missing');
    const actual = sha256(this.readFile(targetPath));
    if (actual === baseline.sha256) return { ok:true, target, sha256:actual, quarantined:Boolean(this.state.quarantine[target]) };
    return this.raiseIncident(target, baseline.sha256, actual, 'digest-mismatch');
  }

  raiseIncident(target, expectedSha256, actualSha256, reason) {
    const incident = {
      id:`integrity_${crypto.randomUUID()}`,
      target,
      expectedSha256,
      actualSha256,
      reason,
      previousIncidentSha256:this.state.incidents.length ? this.state.incidents.at(-1).integritySha256 : null,
      createdAt:this.now(),
    };
    incident.integritySha256 = incidentSeal(incident);
    this.state.incidents.push(incident);
    this.state.quarantine[target] = { incidentId:incident.id, reason, quarantinedAt:incident.createdAt };
    this.persist();
    return { ok:false, target, expectedSha256, actualSha256, reason, quarantined:true, incidentId:incident.id };
  }

  release(targetPath, expectedCurrentSha256, approver) {
    const target = norm(targetPath);
    if (!this.state.quarantine[target]) return { released:false, reason:'not-quarantined' };
    if (!String(approver || '').trim()) throw new Error('SEALED_RELEASE_APPROVER_REQUIRED');
    if (!this.exists(targetPath)) throw new Error('SEALED_RELEASE_TARGET_MISSING');
    const current = sha256(this.readFile(targetPath));
    if (current !== String(expectedCurrentSha256 || '').toLowerCase()) throw new Error('SEALED_RELEASE_DIGEST_MISMATCH');
    const entry = {
      ...this.state.baselines[target],
      sha256:current,
      releasedAt:this.now(),
      releasedBy:String(approver).trim(),
    };
    entry.integritySha256 = baselineSeal(entry);
    this.state.baselines[target] = entry;
    delete this.state.quarantine[target];
    this.persist();
    return { released:true, target, sha256:current };
  }

  persist() {
    this.state.stateSha256 = stateSeal(this.state);
    atomicWrite(this.filePath, this.state);
  }

  isQuarantined(targetPath) { return Boolean(this.state.quarantine[norm(targetPath)]); }
}

module.exports = { SealedIntegritySentinel, sha256, baselineSeal, stateSeal };
