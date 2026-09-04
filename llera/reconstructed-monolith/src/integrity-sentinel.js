'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function ownDataValue(object, key, { required = false } = {}) {
  if (!object || typeof object !== 'object') {
    if (required) throw new TypeError(`integrity manifest field ${key} is required`);
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor) {
    if (required) throw new TypeError(`integrity manifest field ${key} is required`);
    return undefined;
  }
  if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
    throw new TypeError(`integrity manifest field ${key} must be a data property`);
  }
  return descriptor.value;
}

function normalizeManifestEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new TypeError('integrity manifest entry must be an object');
  }

  const entryPath = ownDataValue(entry, 'path', { required: true });
  const sha256 = ownDataValue(entry, 'sha256', { required: true });
  const size = ownDataValue(entry, 'size', { required: true });

  if (typeof entryPath !== 'string' || entryPath.length === 0) {
    throw new TypeError('integrity manifest entry path must be a non-empty string');
  }
  if (typeof sha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(sha256)) {
    throw new TypeError('integrity manifest entry sha256 must be a 64-character hex string');
  }
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new TypeError('integrity manifest entry size must be a non-negative safe integer');
  }

  return { path: entryPath.replace(/\\/g, '/'), sha256: sha256.toLowerCase(), size };
}

function normalizeManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new TypeError('integrity manifest must be an object');
  }

  const files = ownDataValue(manifest, 'files', { required: true });
  if (!Array.isArray(files)) throw new TypeError('manifest.files is required');

  const schemaValue = ownDataValue(manifest, 'schema');
  const productValue = ownDataValue(manifest, 'product');
  const versionValue = ownDataValue(manifest, 'version');

  if (schemaValue !== undefined && (!Number.isSafeInteger(schemaValue) || schemaValue < 1)) {
    throw new TypeError('integrity manifest schema must be a positive safe integer');
  }
  if (productValue !== undefined && typeof productValue !== 'string') {
    throw new TypeError('integrity manifest product must be a string');
  }
  if (versionValue !== undefined && typeof versionValue !== 'string') {
    throw new TypeError('integrity manifest version must be a string');
  }

  return {
    schema: schemaValue === undefined ? 1 : schemaValue,
    product: productValue === undefined ? 'LLera' : productValue,
    version: versionValue === undefined ? '' : versionValue,
    files: files.map(normalizeManifestEntry),
  };
}

function canonicalManifestPayload(manifest) {
  const normalized = normalizeManifest(manifest);
  const files = [...normalized.files].sort((a, b) => a.path.localeCompare(b.path));
  return JSON.stringify({ schema: normalized.schema, product: normalized.product, version: normalized.version, files });
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
    if (typeof relativePath !== 'string' || relativePath.length === 0) {
      throw new TypeError('integrity path must be a non-empty string');
    }
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
    if (typeof signatureBase64 !== 'string') return { verified: false, reason: 'signature-invalid' };
    let payload;
    try {
      payload = Buffer.from(canonicalManifestPayload(manifest));
    } catch (_) {
      return { verified: false, reason: 'manifest-invalid' };
    }
    const signature = Buffer.from(signatureBase64, 'base64');
    const ok = crypto.verify('sha256', payload, this.publicKeyPem, signature);
    return { verified: ok, reason: ok ? 'signature-valid' : 'signature-invalid' };
  }

  verifyFile(entry) {
    let normalized;
    try {
      normalized = normalizeManifestEntry(entry);
    } catch (_) {
      return { ok: false, path: null, reason: 'manifest-entry-invalid' };
    }

    let resolved;
    try {
      resolved = this.resolveExistingSafe(normalized.path);
    } catch (error) {
      if (error && error.code === 'INTEGRITY_SYMLINK_ESCAPE') {
        return { ok: false, path: normalized.path, reason: 'symlink-escape', realTarget: error.realTarget };
      }
      throw error;
    }
    if (!resolved.exists) return { ok: false, path: normalized.path, reason: 'missing' };

    const bytes = fs.readFileSync(resolved.realTarget);
    const actual = sha256Bytes(bytes);
    if (normalized.size !== bytes.length) {
      return { ok: false, path: normalized.path, reason: 'size-mismatch', expectedSize: normalized.size, actualSize: bytes.length, actualSha256: actual };
    }
    if (actual !== normalized.sha256) {
      return { ok: false, path: normalized.path, reason: 'sha256-mismatch', expectedSha256: normalized.sha256, actualSha256: actual };
    }
    return { ok: true, path: normalized.path, sha256: actual, size: bytes.length };
  }

  verifyTree(manifest) {
    let normalized;
    try {
      normalized = normalizeManifest(manifest);
    } catch (_) {
      return { ok: false, checked: 0, failures: [{ ok: false, path: null, reason: 'manifest-invalid' }], results: [] };
    }
    const results = normalized.files.map((entry) => this.verifyFile(entry));
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

module.exports = { IntegritySentinel, sha256Bytes, canonicalManifestPayload, isPathWithin, normalizeManifest, normalizeManifestEntry };
