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
    if (statFile !== null && typeof statFile !== 'function') throw new TypeError('statFile must be a function when provided');
    this.pipeline = pipeline;
    this.readFile = readFile;
    this.captureScreen = captureScreen;
    this.visionModel = visionModel || null;
    this.windowsOcr = windowsOcr || null;
    this.hostguard = hostguard;
    this.statFile = statFile;
  }

  async analyze(args = {}) {
    assertArgs(args);
    const input = await this._resolveInput(args);
    const pressure = await this._pressure();
    return this.pipeline.analyze(input, { pressure, visionModel: this.visionModel, ocr: this.windowsOcr });
  }

  async ocrScreen(args = {}) {
    assertArgs(args);
    const captured = await this.captureScreen(args);
    const envelope = captured && typeof captured === 'object' && !Buffer.isBuffer(captured) && !(captured instanceof Uint8Array)
      ? captured
      : null;
    if (envelope && Array.isArray(envelope)) throw new Error('screen capture result must be bytes or a plain object');
    const bytes = normalizeBytes(envelope && envelope.bytes !== undefined ? envelope.bytes : captured);
    const mime = normalizeMime(
      envelope && envelope.mime !== undefined ? envelope.mime : args.mime,
      'image/png'
    );
    const source = normalizeSource(
      envelope && envelope.source !== undefined ? envelope.source : args.source,
      'desktop-screen'
    );
    const pressure = await this._pressure();
    return this.pipeline.analyze({ kind: 'screen', mime, bytes, source }, { pressure, visionModel: null, ocr: this.windowsOcr });
  }

  async _resolveInput(args) {
    if (args.bytes !== undefined) {
      return {
        kind: normalizeKind(args.kind === undefined ? 'image' : args.kind),
        mime: normalizeMime(args.mime, inferMime(args.path) || 'application/octet-stream'),
        bytes: normalizeBytes(args.bytes),
        source: normalizeSource(args.source, normalizeOptionalPath(args.path) || 'memory')
      };
    }

    const filePath = normalizeRequiredPath(args.path);
    if (this.statFile) {
      const stat = await this.statFile(filePath);
      assertRegularFileStat(stat, this.pipeline.maxBytes);
    }
    const bytes = normalizeBytes(await this.readFile(filePath));
    return {
      kind: normalizeKind(args.kind === undefined ? inferKind(filePath) : args.kind),
      mime: normalizeMime(args.mime, inferMime(filePath) || 'application/octet-stream'),
      bytes,
      source: normalizeSource(args.source, filePath)
    };
  }

  async _pressure() {
    if (!this.hostguard) return 'normal';
    const snapshot = typeof this.hostguard.snapshot === 'function'
      ? await this.hostguard.snapshot()
      : typeof this.hostguard.status === 'function'
        ? await this.hostguard.status()
        : null;
    const raw = snapshot && (snapshot.pressure || snapshot.state || (snapshot.policy && snapshot.policy.pressure));
    if (raw === undefined || raw === null || raw === '') return 'normal';
    if (typeof raw !== 'string') throw new TypeError('HOSTGUARD pressure must be a string');
    return raw.toLowerCase();
  }
}

function assertArgs(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('vision adapter args must be a plain object');
  }
}

function assertRegularFileStat(stat, maxBytes) {
  if (!stat || typeof stat !== 'object' || Array.isArray(stat)) {
    throw new Error('vision input stat is invalid');
  }
  let regular;
  if (typeof stat.isFile === 'function') regular = stat.isFile();
  else if (typeof stat.isFile === 'boolean') regular = stat.isFile;
  else throw new Error('vision input stat is missing isFile');
  if (regular !== true) throw new Error('vision input path is not a file');
  if (typeof stat.size !== 'number' || !Number.isSafeInteger(stat.size) || stat.size <= 0) {
    throw new Error('vision input file size is invalid');
  }
  if (stat.size > maxBytes) throw new Error('vision input exceeds size limit');
}

function normalizeBytes(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value);
  throw new Error('vision input bytes must be Buffer, Uint8Array, or string');
}
function normalizeKind(value) {
  if (typeof value !== 'string') throw new TypeError('vision input kind must be a string');
  const kind = value.toLowerCase();
  if (!['image', 'file', 'screen'].includes(kind)) throw new Error('unsupported vision input kind');
  return kind;
}
function normalizeMime(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') throw new TypeError('vision input mime must be a string');
  return value.toLowerCase();
}
function normalizeSource(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') throw new TypeError('vision input source must be a string');
  return value;
}
function normalizeRequiredPath(value) {
  const filePath = normalizeOptionalPath(value);
  if (!filePath) throw new Error('vision input requires bytes or path');
  return filePath;
}
function normalizeOptionalPath(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new TypeError('vision input path must be a string');
  if (!value.trim() || /[\0\r\n]/.test(value)) throw new Error('unsafe vision input path');
  return value;
}
function inferKind(filePath) {
  const mime = inferMime(filePath);
  return mime && mime.startsWith('image/') ? 'image' : 'file';
}
function inferMime(filePath) {
  if (!filePath) return null;
  if (typeof filePath !== 'string') throw new TypeError('vision input path must be a string');
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] || null;
}

module.exports = { VisionRuntimeAdapter, inferMime, inferKind, normalizeBytes };
