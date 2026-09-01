'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const DEFAULT_IGNORES = Object.freeze(['.git','node_modules','dist','out','build','.DS_Store']);
const SHA256_RE = /^[0-9a-f]{64}$/;

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
function validateRelativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0')) return false;
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false;
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) return false;
  return parts.every(part => !/[\x00-\x1f\x7f]/.test(part));
}
function validateRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { ok:false, reason:'invalid-file-record' };
  if (!validateRelativePath(record.path)) return { ok:false, reason:'invalid-file-path' };
  if (!Number.isSafeInteger(record.bytes) || record.bytes < 0) return { ok:false, reason:'invalid-file-bytes' };
  if (typeof record.sha256 !== 'string' || !SHA256_RE.test(record.sha256)) return { ok:false, reason:'invalid-file-sha256' };
  return { ok:true };
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
  if (!manifest || manifest.kind !== 'reconstructed-source-provenance') return { ok:false, reason:'wrong-manifest-kind' };
  if (manifest.exactHistoricalSource !== false) return { ok:false, reason:'historical-claim-forbidden' };
  if (!Number.isSafeInteger(manifest.schema) || manifest.schema < 1) return { ok:false, reason:'invalid-schema' };
  if (typeof manifest.product !== 'string' || !manifest.product.trim()) return { ok:false, reason:'invalid-product' };
  if (typeof manifest.contentRoot !== 'string' || !SHA256_RE.test(manifest.contentRoot)) return { ok:false, reason:'invalid-content-root' };
  if (typeof manifest.manifestSha256 !== 'string' || !SHA256_RE.test(manifest.manifestSha256)) return { ok:false, reason:'invalid-manifest-digest' };
  if (!Array.isArray(manifest.files)) return { ok:false, reason:'invalid-files' };
  const files = manifest.files;
  const seen = new Set();
  let totalBytes = 0;
  for (const record of files) {
    const valid = validateRecord(record);
    if (!valid.ok) return valid;
    if (seen.has(record.path)) return { ok:false, reason:'duplicate-file-path' };
    seen.add(record.path);
    totalBytes += record.bytes;
    if (!Number.isSafeInteger(totalBytes)) return { ok:false, reason:'total-bytes-overflow' };
  }
  if (!Number.isSafeInteger(manifest.fileCount) || manifest.fileCount !== files.length) return { ok:false, reason:'file-count-mismatch' };
  if (!Number.isSafeInteger(manifest.totalBytes) || manifest.totalBytes !== totalBytes) return { ok:false, reason:'total-bytes-mismatch' };
  const expectedRoot = digestObject(files.map(x => [x.path, x.bytes, x.sha256]));
  if (expectedRoot !== manifest.contentRoot) return { ok:false, reason:'content-root-mismatch' };
  const { manifestSha256, ...unsigned } = manifest;
  const expectedManifest = digestObject(unsigned);
  if (expectedManifest !== manifestSha256) return { ok:false, reason:'manifest-digest-mismatch' };
  return { ok:true, fileCount:files.length, totalBytes, contentRoot:manifest.contentRoot, manifestSha256 };
}
module.exports = { DEFAULT_IGNORES, buildSourceProvenance, verifySourceProvenance, digestObject, sha256File, validateRelativePath };
