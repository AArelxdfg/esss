'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const DEFAULT_IGNORES = Object.freeze(['.git','node_modules','dist','out','build','.DS_Store']);
const SHA256_RE = /^[a-f0-9]{64}$/;

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => { out[key] = stable(value[key]); return out; }, {});
  }
  return value;
}
function digestObject(value) {
  return sha256Buffer(Buffer.from(JSON.stringify(stable(value))));
}
async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(file);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}
async function walk(rootDir, ignores = DEFAULT_IGNORES) {
  const out = [];
  const ignore = new Set(ignores);
  async function visit(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    entries.sort((a,b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (ignore.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(abs);
      else if (entry.isFile()) out.push(abs);
    }
  }
  await visit(rootDir);
  return out;
}
function validateManifestFiles(files) {
  if (!Array.isArray(files)) return { ok:false, reason:'files-not-array' };
  const seen = new Set();
  let prior = null;
  let totalBytes = 0;
  for (const record of files) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return { ok:false, reason:'invalid-file-record' };
    const rel = record.path;
    if (typeof rel !== 'string' || !rel || rel.includes('\\') || rel.startsWith('/') || /^[A-Za-z]:\//.test(rel)) {
      return { ok:false, reason:'invalid-file-path' };
    }
    const normalized = path.posix.normalize(rel);
    if (normalized !== rel || normalized === '..' || normalized.startsWith('../') || normalized.startsWith('./')) {
      return { ok:false, reason:'unsafe-file-path' };
    }
    if (seen.has(rel)) return { ok:false, reason:'duplicate-file-path' };
    if (prior !== null && prior.localeCompare(rel) >= 0) return { ok:false, reason:'noncanonical-file-order' };
    seen.add(rel);
    prior = rel;
    if (!Number.isSafeInteger(record.bytes) || record.bytes < 0) return { ok:false, reason:'invalid-file-bytes' };
    if (typeof record.sha256 !== 'string' || !SHA256_RE.test(record.sha256)) return { ok:false, reason:'invalid-file-sha256' };
    totalBytes += record.bytes;
    if (!Number.isSafeInteger(totalBytes)) return { ok:false, reason:'total-bytes-overflow' };
  }
  return { ok:true, fileCount:files.length, totalBytes };
}
async function buildSourceProvenance({ rootDir, product='LLera reconstructed MONOLITH OMEGA', schema=1, ignores=DEFAULT_IGNORES, createdAt=null } = {}) {
  if (!rootDir) throw new Error('rootDir is required');
  const root = path.resolve(rootDir);
  const files = await walk(root, ignores);
  const records = [];
  for (const abs of files) {
    const stat = await fsp.stat(abs);
    const rel = path.relative(root, abs).split(path.sep).join('/');
    records.push({ path: rel, bytes: stat.size, sha256: await sha256File(abs) });
  }
  records.sort((a,b) => a.path.localeCompare(b.path));
  const contentRoot = digestObject(records.map(x => [x.path, x.bytes, x.sha256]));
  const manifest = {
    schema, product, kind:'reconstructed-source-provenance', exactHistoricalSource:false,
    createdAt, fileCount:records.length, totalBytes:records.reduce((n,x)=>n+x.bytes,0), contentRoot, files:records
  };
  return { ...manifest, manifestSha256:digestObject(manifest) };
}
function verifySourceProvenance(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || manifest.kind !== 'reconstructed-source-provenance') {
    return { ok:false, reason:'wrong-manifest-kind' };
  }
  if (manifest.exactHistoricalSource !== false) return { ok:false, reason:'historical-claim-forbidden' };
  const validation = validateManifestFiles(manifest.files);
  if (!validation.ok) return validation;
  const files = manifest.files;
  if (manifest.fileCount !== validation.fileCount) return { ok:false, reason:'file-count-mismatch' };
  if (manifest.totalBytes !== validation.totalBytes) return { ok:false, reason:'total-bytes-mismatch' };
  if (typeof manifest.contentRoot !== 'string' || !SHA256_RE.test(manifest.contentRoot)) return { ok:false, reason:'invalid-content-root' };
  if (typeof manifest.manifestSha256 !== 'string' || !SHA256_RE.test(manifest.manifestSha256)) return { ok:false, reason:'invalid-manifest-sha256' };
  const expectedRoot = digestObject(files.map(x => [x.path, x.bytes, x.sha256]));
  if (expectedRoot !== manifest.contentRoot) return { ok:false, reason:'content-root-mismatch' };
  const { manifestSha256, ...unsigned } = manifest;
  const expectedManifest = digestObject(unsigned);
  if (expectedManifest !== manifestSha256) return { ok:false, reason:'manifest-digest-mismatch' };
  return { ok:true, fileCount:validation.fileCount, totalBytes:validation.totalBytes, contentRoot:manifest.contentRoot, manifestSha256 };
}
module.exports = { DEFAULT_IGNORES, buildSourceProvenance, verifySourceProvenance, digestObject, sha256File, validateManifestFiles };
