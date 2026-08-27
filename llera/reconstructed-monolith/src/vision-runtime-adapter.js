'use strict';

const path = require('path');

const MIME_BY_EXT = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain'
});

class VisionRuntimeAdapter {
  constructor({ pipeline, readFile, captureScreen, visionModel, windowsOcr, hostguard = null, statFile = null } = {}) {
    if (!pipeline || typeof pipeline.analyze !== 'function') throw new Error('pipeline.analyze is required');
    if (typeof readFile !== 'function') throw new Error('readFile(path) is required');
    if (typeof captureScreen !== 'function') throw new Error('captureScreen() is required');
    if (typeof visionModel !== 'function' && typeof windowsOcr !== 'function') throw new Error('visionModel or windowsOcr backend is required');
    this.pipeline = pipeline;
    this.readFile = readFile;
    this.captureScreen = captureScreen;
    this.visionModel = visionModel || null;
    this.windowsOcr = windowsOcr || null;
    this.hostguard = hostguard;
    this.statFile = statFile;
  }

  async analyze(args = {}) {
    const input = await this._resolveInput(args);
    const pressure = await this._pressure();
    return this.pipeline.analyze(input, { pressure, visionModel: this.visionModel, ocr: this.windowsOcr });
  }

  async ocrScreen(args = {}) {
    const captured = await this.captureScreen(args);
    const bytes = normalizeBytes(captured && captured.bytes !== undefined ? captured.bytes : captured);
    const mime = String((captured && captured.mime) || args.mime || 'image/png').toLowerCase();
    const source = String((captured && captured.source) || args.source || 'desktop-screen');
    const pressure = await this._pressure();
    return this.pipeline.analyze({ kind: 'screen', mime, bytes, source }, { pressure, visionModel: null, ocr: this.windowsOcr });
  }

  async _resolveInput(args) {
    if (args.bytes !== undefined) {
      return {
        kind: normalizeKind(args.kind || 'image'),
        mime: String(args.mime || inferMime(args.path) || 'application/octet-stream').toLowerCase(),
        bytes: normalizeBytes(args.bytes),
        source: String(args.source || args.path || 'memory')
      };
    }

    if (!args.path) throw new Error('vision input requires bytes or path');
    const filePath = String(args.path);
    if (this.statFile) {
      const stat = await this.statFile(filePath);
      if (!stat || stat.isFile === false) throw new Error('vision input path is not a file');
      if (Number.isFinite(stat.size) && stat.size <= 0) throw new Error('empty vision input file');
      if (Number.isFinite(stat.size) && stat.size > this.pipeline.maxBytes) throw new Error('vision input exceeds size limit');
    }
    const bytes = normalizeBytes(await this.readFile(filePath));
    return {
      kind: normalizeKind(args.kind || inferKind(filePath)),
      mime: String(args.mime || inferMime(filePath) || 'application/octet-stream').toLowerCase(),
      bytes,
      source: String(args.source || filePath)
    };
  }

  async _pressure() {
    if (!this.hostguard) return 'normal';
    const snapshot = typeof this.hostguard.snapshot === 'function'
      ? await this.hostguard.snapshot()
      : typeof this.hostguard.status === 'function'
        ? await this.hostguard.status()
        : null;
    return String(snapshot && (snapshot.pressure || snapshot.state || (snapshot.policy && snapshot.policy.pressure)) || 'normal').toLowerCase();
  }
}

function normalizeBytes(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value);
  throw new Error('vision input bytes must be Buffer, Uint8Array, or string');
}
function normalizeKind(value) {
  const kind = String(value || '').toLowerCase();
  if (!['image', 'file', 'screen'].includes(kind)) throw new Error('unsupported vision input kind');
  return kind;
}
function inferKind(filePath) {
  const mime = inferMime(filePath);
  return mime && mime.startsWith('image/') ? 'image' : 'file';
}
function inferMime(filePath) {
  if (!filePath) return null;
  return MIME_BY_EXT[path.extname(String(filePath)).toLowerCase()] || null;
}

module.exports = { VisionRuntimeAdapter, inferMime, inferKind, normalizeBytes };
