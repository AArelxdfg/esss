'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const DEFAULT_IGNORES = Object.freeze(['.git','node_modules','dist','out','build','.DS_Store']);

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
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const expectedRoot = digestObject(files.map(x => [x.path, x.bytes, x.sha256]));
  if (expectedRoot !== manifest.contentRoot) return { ok:false, reason:'content-root-mismatch' };
  const { manifestSha256, ...unsigned } = manifest;
  const expectedManifest = digestObject(unsigned);
  if (expectedManifest !== manifestSha256) return { ok:false, reason:'manifest-digest-mismatch' };
  return { ok:true, fileCount:files.length, totalBytes:files.reduce((n,x)=>n+Number(x.bytes||0),0), contentRoot:manifest.contentRoot, manifestSha256 };
}
module.exports = { DEFAULT_IGNORES, buildSourceProvenance, verifySourceProvenance, digestObject, sha256File };
