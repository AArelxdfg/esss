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

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(file);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

class SignedUpdateLifecycle {
  constructor({ rootDir, publicKey, fetchImpl = globalThis.fetch, onProgress = () => {} } = {}) {
    if (!rootDir) throw new Error('rootDir is required');
    if (!publicKey) throw new Error('publicKey is required');
    this.rootDir = path.resolve(rootDir);
    this.publicKey = publicKey;
    this.fetchImpl = fetchImpl;
    this.onProgress = onProgress;
    this.paths = {
      downloads: path.join(this.rootDir, 'downloads'),
      staging: path.join(this.rootDir, 'staging'),
      current: path.join(this.rootDir, 'current'),
      backup: path.join(this.rootDir, 'rollback'),
      journal: path.join(this.rootDir, 'update-journal.json'),
    };
  }

  async init() {
    await Promise.all([
      fsp.mkdir(this.paths.downloads, { recursive: true }),
      fsp.mkdir(this.paths.staging, { recursive: true }),
      fsp.mkdir(this.paths.backup, { recursive: true }),
    ]);
  }

  verifySignedManifest(manifest, signatureBase64) {
    if (!manifest || typeof manifest !== 'object') throw new Error('manifest required');
    const payload = Buffer.from(stableStringify(manifest));
    const signature = Buffer.from(signatureBase64 || '', 'base64');
    if (!signature.length) throw new Error('manifest signature missing');
    const ok = crypto.verify(null, payload, this.publicKey, signature);
    if (!ok) throw new Error('manifest signature invalid');
    if (!manifest.version || !manifest.artifact) throw new Error('manifest schema invalid');
    if (!/^[a-f0-9]{64}$/i.test(manifest.artifact.sha256 || '')) throw new Error('artifact sha256 invalid');
    if (!Number.isSafeInteger(manifest.artifact.size) || manifest.artifact.size < 1) throw new Error('artifact size invalid');
    return { verified: true, payloadSha256: sha256Buffer(payload) };
  }

  async downloadArtifact(manifest, { resume = true } = {}) {
    await this.init();
    const artifact = manifest.artifact;
    const finalPath = path.join(this.paths.downloads, `${manifest.version}.bin`);
    const partPath = `${finalPath}.part`;
    let offset = 0;
    if (resume) {
      try { offset = (await fsp.stat(partPath)).size; } catch { offset = 0; }
      if (offset > artifact.size) {
        await fsp.rm(partPath, { force: true });
        offset = 0;
      }
    } else {
      await fsp.rm(partPath, { force: true });
    }

    const headers = offset ? { Range: `bytes=${offset}-` } : {};
    const response = await this.fetchImpl(artifact.url, { headers });
    if (!response || !response.ok) throw new Error(`download failed: ${response && response.status}`);
    if (offset && response.status !== 206) {
      await fsp.rm(partPath, { force: true });
      return this.downloadArtifact(manifest, { resume: false });
    }

    const handle = await fsp.open(partPath, offset ? 'a' : 'w');
    let received = offset;
    try {
      for await (const chunk of response.body) {
        const buf = Buffer.from(chunk);
        await handle.write(buf);
        received += buf.length;
        this.onProgress({ phase: 'download', received, total: artifact.size, percent: Math.min(100, received / artifact.size * 100) });
      }
    } finally {
      await handle.close();
    }

    const st = await fsp.stat(partPath);
    if (st.size !== artifact.size) throw new Error(`artifact size mismatch: ${st.size} != ${artifact.size}`);
    const digest = await sha256File(partPath);
    if (digest.toLowerCase() !== artifact.sha256.toLowerCase()) throw new Error('artifact sha256 mismatch');
    await fsp.rename(partPath, finalPath);
    this.onProgress({ phase: 'verified', received: st.size, total: artifact.size, percent: 100 });
    return { path: finalPath, sha256: digest, size: st.size };
  }

  async stageArtifact(manifest, downloadedPath) {
    const stageDir = path.join(this.paths.staging, manifest.version);
    await fsp.rm(stageDir, { recursive: true, force: true });
    await fsp.mkdir(stageDir, { recursive: true });
    const staged = path.join(stageDir, 'LLera-update.bin');
    await fsp.copyFile(downloadedPath, staged);
    const digest = await sha256File(staged);
    if (digest.toLowerCase() !== manifest.artifact.sha256.toLowerCase()) throw new Error('staged artifact integrity mismatch');
    await this._writeJournal({ state: 'staged', version: manifest.version, staged, sha256: digest });
    return staged;
  }

  async activateStaged(manifest, stagedPath) {
    await this.init();
    const currentFile = path.join(this.paths.current, 'LLera.bin');
    const backupFile = path.join(this.paths.backup, 'LLera.previous.bin');
    await fsp.mkdir(this.paths.current, { recursive: true });
    await fsp.mkdir(this.paths.backup, { recursive: true });
    let hadCurrent = false;
    try {
      await fsp.access(currentFile);
      hadCurrent = true;
      await fsp.copyFile(currentFile, backupFile);
    } catch {}

    const tmp = `${currentFile}.new`;
    await fsp.copyFile(stagedPath, tmp);
    const digest = await sha256File(tmp);
    if (digest.toLowerCase() !== manifest.artifact.sha256.toLowerCase()) {
      await fsp.rm(tmp, { force: true });
      throw new Error('activation integrity mismatch');
    }
    await fsp.rename(tmp, currentFile);
    await this._writeJournal({ state: 'activated', version: manifest.version, currentFile, backupFile: hadCurrent ? backupFile : null, sha256: digest });
    this.onProgress({ phase: 'activated', percent: 100, version: manifest.version });
    return { currentFile, backupAvailable: hadCurrent };
  }

  async rollback() {
    const journal = await this.readJournal();
    if (!journal || journal.state !== 'activated' || !journal.backupFile) throw new Error('rollback unavailable');
    const currentFile = journal.currentFile;
    const backupDigest = await sha256File(journal.backupFile);
    const tmp = `${currentFile}.rollback`;
    await fsp.copyFile(journal.backupFile, tmp);
    await fsp.rename(tmp, currentFile);
    await this._writeJournal({ state: 'rolled-back', fromVersion: journal.version, currentFile, restoredSha256: backupDigest });
    this.onProgress({ phase: 'rolled-back', percent: 100 });
    return { currentFile, restoredSha256: backupDigest };
  }

  async readJournal() {
    try { return JSON.parse(await fsp.readFile(this.paths.journal, 'utf8')); } catch { return null; }
  }

  async _writeJournal(value) {
    await fsp.mkdir(this.rootDir, { recursive: true });
    const tmp = `${this.paths.journal}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify({ ...value, at: new Date().toISOString() }, null, 2));
    await fsp.rename(tmp, this.paths.journal);
  }
}

module.exports = { SignedUpdateLifecycle, stableStringify, sha256File };
