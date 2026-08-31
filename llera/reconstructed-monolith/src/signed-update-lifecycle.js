'use strict';

const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function sha256Buffer(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(file);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}
function safeVersionSegment(version) {
  const value = String(version || '');
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(value) || value === '.' || value === '..') throw new Error('manifest version unsafe');
  return value;
}
function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const wanted = String(name).toLowerCase();
  for (const [key, value] of Object.entries(headers)) if (String(key).toLowerCase() === wanted) return value;
  return null;
}
function parseContentRange(value) {
  const match = String(value || '').trim().match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
  if (!match) return null;
  return { start: Number(match[1]), end: Number(match[2]), total: match[3] === '*' ? null : Number(match[3]) };
}
function pathIdentity(value) {
  const resolved = path.resolve(String(value || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

class SignedUpdateLifecycle {
  constructor({ rootDir, publicKey, fetchImpl = globalThis.fetch, onProgress = () => {} } = {}) {
    if (!rootDir) throw new Error('rootDir is required');
    if (!publicKey) throw new Error('publicKey is required');
    this.rootDir = path.resolve(rootDir);
    this.publicKey = publicKey;
    this.fetchImpl = fetchImpl;
    this.onProgress = onProgress;
    this._verifiedManifestPayloads = new Map();
    this.paths = {
      downloads: path.join(this.rootDir, 'downloads'), staging: path.join(this.rootDir, 'staging'),
      current: path.join(this.rootDir, 'current'), backup: path.join(this.rootDir, 'rollback'),
      journal: path.join(this.rootDir, 'update-journal.json')
    };
  }
  async init() {
    await Promise.all([fsp.mkdir(this.paths.downloads,{recursive:true}),fsp.mkdir(this.paths.staging,{recursive:true}),fsp.mkdir(this.paths.backup,{recursive:true})]);
  }
  _manifestPayloadSha256(manifest) {
    return sha256Buffer(Buffer.from(stableStringify(manifest)));
  }
  _requireVerifiedManifest(manifest) {
    if (!manifest || typeof manifest !== 'object') throw new Error('manifest required');
    const payloadSha256 = this._manifestPayloadSha256(manifest);
    const verified = this._verifiedManifestPayloads.get(payloadSha256);
    if (!verified) throw new Error('manifest not verified for update lifecycle');
    return { payloadSha256, ...verified };
  }
  _requireBoundJournalPath(actual, expected, label) {
    if (!actual || pathIdentity(actual) !== pathIdentity(expected)) throw new Error(`rollback ${label} path binding mismatch`);
    return expected;
  }
  verifySignedManifest(manifest, signatureBase64) {
    if (!manifest || typeof manifest !== 'object') throw new Error('manifest required');
    const payload = Buffer.from(stableStringify(manifest));
    const signature = Buffer.from(signatureBase64 || '', 'base64');
    if (!signature.length) throw new Error('manifest signature missing');
    if (!crypto.verify(null, payload, this.publicKey, signature)) throw new Error('manifest signature invalid');
    if (!manifest.version || !manifest.artifact) throw new Error('manifest schema invalid');
    safeVersionSegment(manifest.version);
    if (!/^[a-f0-9]{64}$/i.test(manifest.artifact.sha256 || '')) throw new Error('artifact sha256 invalid');
    if (!Number.isSafeInteger(manifest.artifact.size) || manifest.artifact.size < 1) throw new Error('artifact size invalid');
    let artifactUrl;
    try { artifactUrl = new URL(String(manifest.artifact.url || '')); } catch { throw new Error('artifact url invalid'); }
    if (artifactUrl.protocol !== 'https:') throw new Error('artifact url must use https');
    const payloadSha256 = sha256Buffer(payload);
    const signatureSha256 = sha256Buffer(signature);
    this._verifiedManifestPayloads.set(payloadSha256, { signatureSha256 });
    return { verified: true, payloadSha256, signatureSha256 };
  }
  async downloadArtifact(manifest, { resume = true } = {}) {
    this._requireVerifiedManifest(manifest);
    await this.init();
    const artifact = manifest.artifact;
    const version = safeVersionSegment(manifest.version);
    const finalPath = path.join(this.paths.downloads, `${version}.bin`);
    const partPath = `${finalPath}.part`;
    let offset = 0;
    if (resume) {
      try { offset = (await fsp.stat(partPath)).size; } catch { offset = 0; }
      if (offset > artifact.size) { await fsp.rm(partPath,{force:true}); offset = 0; }
    } else await fsp.rm(partPath,{force:true});
    const headers = offset ? { Range: `bytes=${offset}-` } : {};
    const response = await this.fetchImpl(artifact.url,{headers});
    if (!response || !response.ok) throw new Error(`download failed: ${response && response.status}`);
    if (offset) {
      if (response.status !== 206) { await fsp.rm(partPath,{force:true}); return this.downloadArtifact(manifest,{resume:false}); }
      const range = parseContentRange(headerValue(response.headers,'content-range'));
      if (!range || range.start !== offset || range.end < range.start || (range.total != null && range.total !== artifact.size)) {
        await fsp.rm(partPath,{force:true});
        throw new Error('resume content-range mismatch');
      }
    }
    const handle = await fsp.open(partPath,offset?'a':'w');
    let received = offset;
    try {
      for await (const chunk of response.body) {
        const buf = Buffer.from(chunk);
        if (received + buf.length > artifact.size) throw new Error('artifact download exceeded signed size');
        await handle.write(buf); received += buf.length;
        this.onProgress({phase:'download',received,total:artifact.size,percent:Math.min(100,received/artifact.size*100)});
      }
    } finally { await handle.close(); }
    const st = await fsp.stat(partPath);
    if (st.size !== artifact.size) throw new Error(`artifact size mismatch: ${st.size} != ${artifact.size}`);
    const digest = await sha256File(partPath);
    if (digest.toLowerCase() !== artifact.sha256.toLowerCase()) throw new Error('artifact sha256 mismatch');
    await fsp.rename(partPath,finalPath);
    this.onProgress({phase:'verified',received:st.size,total:artifact.size,percent:100});
    return {path:finalPath,sha256:digest,size:st.size};
  }
  async stageArtifact(manifest, downloadedPath) {
    this._requireVerifiedManifest(manifest);
    const version = safeVersionSegment(manifest.version);
    const stageDir = path.join(this.paths.staging,version);
    await fsp.rm(stageDir,{recursive:true,force:true}); await fsp.mkdir(stageDir,{recursive:true});
    const staged = path.join(stageDir,'LLera-update.bin'); await fsp.copyFile(downloadedPath,staged);
    const digest = await sha256File(staged);
    if (digest.toLowerCase() !== manifest.artifact.sha256.toLowerCase()) throw new Error('staged artifact integrity mismatch');
    const verifiedManifest=this._requireVerifiedManifest(manifest);
    await this._writeJournal({state:'staged',version,staged,sha256:digest,manifestPayloadSha256:verifiedManifest.payloadSha256,manifestSignatureSha256:verifiedManifest.signatureSha256}); return staged;
  }
  async activateStaged(manifest, stagedPath) {
    const verifiedManifest=this._requireVerifiedManifest(manifest);
    await this.init(); const version = safeVersionSegment(manifest.version);
    const currentFile=path.join(this.paths.current,'LLera.bin'), backupFile=path.join(this.paths.backup,'LLera.previous.bin');
    await fsp.mkdir(this.paths.current,{recursive:true}); await fsp.mkdir(this.paths.backup,{recursive:true});
    let hadCurrent=false, backupSha256=null;
    try {
      await fsp.access(currentFile);
      hadCurrent=true;
      await fsp.copyFile(currentFile,backupFile);
      backupSha256=await sha256File(backupFile);
    } catch {}
    const tmp=`${currentFile}.new`; await fsp.copyFile(stagedPath,tmp); const digest=await sha256File(tmp);
    if (digest.toLowerCase() !== manifest.artifact.sha256.toLowerCase()) { await fsp.rm(tmp,{force:true}); throw new Error('activation integrity mismatch'); }
    await fsp.rename(tmp,currentFile);
    await this._writeJournal({
      state:'activated',version,currentFile,
      backupFile:hadCurrent?backupFile:null,
      backupSha256:hadCurrent?backupSha256:null,
      sha256:digest,
      manifestPayloadSha256:verifiedManifest.payloadSha256,
      manifestSignatureSha256:verifiedManifest.signatureSha256
    });
    this.onProgress({phase:'activated',percent:100,version}); return {currentFile,backupAvailable:hadCurrent,backupSha256};
  }
  async rollback() {
    const journal=await this.readJournal();
    if(!journal||journal.state!=='activated'||!journal.backupFile) throw new Error('rollback unavailable');
    if(!/^[a-f0-9]{64}$/i.test(String(journal.backupSha256 || ''))) throw new Error('rollback backup digest unavailable');
    if(!/^[a-f0-9]{64}$/i.test(String(journal.manifestPayloadSha256 || '')) || !/^[a-f0-9]{64}$/i.test(String(journal.manifestSignatureSha256 || ''))) throw new Error('rollback manifest provenance unavailable');
    const expectedCurrentFile=path.join(this.paths.current,'LLera.bin');
    const expectedBackupFile=path.join(this.paths.backup,'LLera.previous.bin');
    const currentFile=this._requireBoundJournalPath(journal.currentFile,expectedCurrentFile,'current');
    const backupFile=this._requireBoundJournalPath(journal.backupFile,expectedBackupFile,'backup');
    const backupDigest=await sha256File(backupFile);
    if (backupDigest.toLowerCase() !== journal.backupSha256.toLowerCase()) {
      throw new Error('rollback backup integrity mismatch');
    }
    const tmp=`${currentFile}.rollback`;
    await fsp.copyFile(backupFile,tmp);
    const tmpDigest=await sha256File(tmp);
    if (tmpDigest.toLowerCase() !== journal.backupSha256.toLowerCase()) {
      await fsp.rm(tmp,{force:true});
      throw new Error('rollback copy integrity mismatch');
    }
    await fsp.rename(tmp,currentFile);
    await this._writeJournal({
      state:'rolled-back',fromVersion:journal.version,currentFile,
      restoredSha256:backupDigest,expectedBackupSha256:journal.backupSha256,
      manifestPayloadSha256:journal.manifestPayloadSha256,
      manifestSignatureSha256:journal.manifestSignatureSha256
    });
    this.onProgress({phase:'rolled-back',percent:100}); return {currentFile,restoredSha256:backupDigest};
  }
  async readJournal() { try { return JSON.parse(await fsp.readFile(this.paths.journal,'utf8')); } catch { return null; } }
  async _writeJournal(value) {
    await fsp.mkdir(this.rootDir,{recursive:true}); const tmp=`${this.paths.journal}.tmp`;
    await fsp.writeFile(tmp,JSON.stringify({...value,at:new Date().toISOString()},null,2)); await fsp.rename(tmp,this.paths.journal);
  }
}
module.exports={SignedUpdateLifecycle,stableStringify,sha256File,safeVersionSegment,parseContentRange,pathIdentity};
