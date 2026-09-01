'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function canonicalManifestPayload(manifest) {
  const files = [...(manifest.files || [])]
    .map((x) => ({ path: x.path.replace(/\\/g, '/'), sha256: String(x.sha256).toLowerCase(), size: Number(x.size) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return JSON.stringify({ schema: manifest.schema || 1, product: manifest.product || 'LLera', version: manifest.version || '', files });
}

function isPathWithin(root, target) {
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return target === root || target.startsWith(prefix);
}

class IntegritySentinel {
  constructor({ rootDir, publicKeyPem = null, quarantineDir = null } = {}) {
    if (!rootDir) throw new Error('rootDir is required');
    this.rootDir = path.resolve(rootDir);
    this.publicKeyPem = publicKeyPem;
    this.quarantineDir = path.resolve(quarantineDir || path.join(this.rootDir, '.quarantine'));
  }

  resolveSafe(relativePath) {
    const target = path.resolve(this.rootDir, relativePath);
    if (!isPathWithin(this.rootDir, target)) throw new Error(`integrity path escape blocked: ${relativePath}`);
    return target;
  }

  resolveExistingSafe(relativePath) {
    const target = this.resolveSafe(relativePath);
    if (!fs.existsSync(target)) return { target, exists: false, realTarget: null };

    const realRoot = fs.realpathSync.native ? fs.realpathSync.native(this.rootDir) : fs.realpathSync(this.rootDir);
    const realTarget = fs.realpathSync.native ? fs.realpathSync.native(target) : fs.realpathSync(target);
    if (!isPathWithin(realRoot, realTarget)) {
      const error = new Error(`integrity symlink escape blocked: ${relativePath}`);
      error.code = 'INTEGRITY_SYMLINK_ESCAPE';
      error.relativePath = relativePath;
      error.realTarget = realTarget;
      throw error;
    }
    return { target, exists: true, realTarget };
  }

  verifyManifestSignature(manifest, signatureBase64) {
    if (!this.publicKeyPem) return { verified: false, reason: 'no-public-key' };
    const payload = Buffer.from(canonicalManifestPayload(manifest));
    const signature = Buffer.from(signatureBase64 || '', 'base64');
    const ok = crypto.verify('sha256', payload, this.publicKeyPem, signature);
    return { verified: ok, reason: ok ? 'signature-valid' : 'signature-invalid' };
  }

  verifyFile(entry) {
    let resolved;
    try {
      resolved = this.resolveExistingSafe(entry.path);
    } catch (error) {
      if (error && error.code === 'INTEGRITY_SYMLINK_ESCAPE') {
        return { ok: false, path: entry.path, reason: 'symlink-escape', realTarget: error.realTarget };
      }
      throw error;
    }
    if (!resolved.exists) return { ok: false, path: entry.path, reason: 'missing' };

    const bytes = fs.readFileSync(resolved.realTarget);
    const actual = sha256Bytes(bytes);
    if (Number.isFinite(Number(entry.size)) && Number(entry.size) !== bytes.length) {
      return { ok: false, path: entry.path, reason: 'size-mismatch', expectedSize: Number(entry.size), actualSize: bytes.length, actualSha256: actual };
    }
    if (actual !== String(entry.sha256).toLowerCase()) {
      return { ok: false, path: entry.path, reason: 'sha256-mismatch', expectedSha256: String(entry.sha256).toLowerCase(), actualSha256: actual };
    }
    return { ok: true, path: entry.path, sha256: actual, size: bytes.length };
  }

  verifyTree(manifest) {
    if (!manifest || !Array.isArray(manifest.files)) throw new Error('manifest.files is required');
    const results = manifest.files.map((entry) => this.verifyFile(entry));
    const failures = results.filter((x) => !x.ok);
    return { ok: failures.length === 0, checked: results.length, failures, results };
  }

  quarantine(relativePath, reason = 'integrity-failure') {
    let resolved;
    try {
      resolved = this.resolveExistingSafe(relativePath);
    } catch (error) {
      if (error && error.code === 'INTEGRITY_SYMLINK_ESCAPE') {
        return { moved: false, reason: 'symlink-escape', path: relativePath, realTarget: error.realTarget };
      }
      throw error;
    }
    if (!resolved.exists) return { moved: false, reason: 'missing', path: relativePath };

    fs.mkdirSync(this.quarantineDir, { recursive: true });
    const suffix = sha256Bytes(Buffer.from(`${relativePath}:${reason}:${Date.now()}`)).slice(0, 12);
    const target = path.join(this.quarantineDir, `${path.basename(relativePath)}.${suffix}.quarantine`);
    fs.renameSync(resolved.target, target);
    return { moved: true, reason, source: resolved.target, target };
  }

  assertTrusted(manifest, signatureBase64 = null, { requireSignature = false } = {}) {
    const tree = this.verifyTree(manifest);
    if (!tree.ok) return { trusted: false, tree, signature: null };
    if (requireSignature || this.publicKeyPem) {
      const signature = this.verifyManifestSignature(manifest, signatureBase64);
      return { trusted: signature.verified, tree, signature };
    }
    return { trusted: true, tree, signature: { verified: false, reason: 'signature-not-required' } };
  }
}

module.exports = { IntegritySentinel, sha256Bytes, canonicalManifestPayload, isPathWithin };
