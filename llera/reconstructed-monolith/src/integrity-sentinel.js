'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function normalizeManifestPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function validateManifestPath(value) {
  if (typeof value !== 'string') return { ok: false, normalizedPath: '', reason: 'path-string-required' };
  const normalizedPath = normalizeManifestPath(value);
  if (!normalizedPath || normalizedPath === '.' || normalizedPath.endsWith('/')) {
    return { ok: false, normalizedPath, reason: 'invalid-path' };
  }
  if (normalizedPath.includes('\0')) {
    return { ok: false, normalizedPath, reason: 'path-nul-byte' };
  }
  if (normalizedPath.startsWith('/') || normalizedPath.startsWith('//') || /^[a-zA-Z]:\//.test(normalizedPath)) {
    return { ok: false, normalizedPath, reason: 'absolute-path' };
  }
  const segments = normalizedPath.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return { ok: false, normalizedPath, reason: 'non-canonical-path' };
  }
  for (const segment of segments) {
    if (/[\x01-\x1f<>"|?*]/.test(segment)) {
      return { ok: false, normalizedPath, reason: 'windows-illegal-char' };
    }
    if (segment.includes(':')) {
      return { ok: false, normalizedPath, reason: 'windows-ads-path' };
    }
    if (/[. ]$/.test(segment)) {
      return { ok: false, normalizedPath, reason: 'windows-trailing-dot-space' };
    }
    const deviceBase = segment.split('.')[0].toUpperCase();
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(deviceBase)) {
      return { ok: false, normalizedPath, reason: 'windows-reserved-name' };
    }
  }
  return { ok: true, normalizedPath };
}

function validateManifest(manifest) {
  const failures = [];
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.files)) {
    return { ok: false, failures: [{ reason: 'manifest-files-required' }] };
  }
  if (manifest.files.length === 0) {
    return { ok: false, failures: [{ reason: 'manifest-files-empty' }] };
  }

  const seenPaths = new Set();
  const seenWindowsPaths = new Set();
  for (let index = 0; index < manifest.files.length; index += 1) {
    const entry = manifest.files[index];
    if (!entry || typeof entry !== 'object') {
      failures.push({ index, reason: 'entry-object-required' });
      continue;
    }

    const pathValidation = validateManifestPath(entry.path);
    const normalizedPath = pathValidation.normalizedPath;
    if (!pathValidation.ok) {
      failures.push({ index, path: normalizedPath, reason: pathValidation.reason });
    } else {
      const windowsKey = normalizedPath.toLowerCase();
      if (seenPaths.has(normalizedPath)) {
        failures.push({ index, path: normalizedPath, reason: 'duplicate-path' });
      } else if (seenWindowsPaths.has(windowsKey)) {
        failures.push({ index, path: normalizedPath, reason: 'windows-path-alias' });
      } else {
        seenPaths.add(normalizedPath);
        seenWindowsPaths.add(windowsKey);
      }
    }

    if (!/^[a-f0-9]{64}$/i.test(String(entry.sha256 || ''))) {
      failures.push({ index, path: normalizedPath, reason: 'invalid-sha256' });
    }

    const size = Number(entry.size);
    if (!Number.isSafeInteger(size) || size < 0) {
      failures.push({ index, path: normalizedPath, reason: 'invalid-size' });
    }
  }

  return { ok: failures.length === 0, failures };
}

function canonicalManifestPayload(manifest) {
  const files = [...(manifest.files || [])]
    .map((x) => ({ path: normalizeManifestPath(x.path), sha256: String(x.sha256).toLowerCase(), size: Number(x.size) }))
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
    const validation = validateManifest(manifest);
    if (!validation.ok) return { verified: false, reason: 'manifest-invalid', failures: validation.failures };
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
    if (Number(entry.size) !== bytes.length) {
      return { ok: false, path: entry.path, reason: 'size-mismatch', expectedSize: Number(entry.size), actualSize: bytes.length, actualSha256: actual };
    }
    if (actual !== String(entry.sha256).toLowerCase()) {
      return { ok: false, path: entry.path, reason: 'sha256-mismatch', expectedSha256: String(entry.sha256).toLowerCase(), actualSha256: actual };
    }
    return { ok: true, path: entry.path, sha256: actual, size: bytes.length };
  }

  verifyTree(manifest) {
    const validation = validateManifest(manifest);
    if (!validation.ok) {
      const failures = validation.failures.map((failure) => ({ ok: false, ...failure }));
      return { ok: false, checked: 0, failures, results: [], manifestValid: false };
    }
    const results = manifest.files.map((entry) => this.verifyFile(entry));
    const failures = results.filter((x) => !x.ok);
    return { ok: failures.length === 0, checked: results.length, failures, results, manifestValid: true };
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

module.exports = { IntegritySentinel, sha256Bytes, canonicalManifestPayload, isPathWithin, validateManifest, validateManifestPath, normalizeManifestPath };
