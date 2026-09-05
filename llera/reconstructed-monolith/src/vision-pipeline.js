'use strict';
const crypto = require('crypto');

function ownDataProperty(object, key) {
  if (!object || typeof object !== 'object') return { present: false, value: undefined };
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor) return { present: false, value: undefined };
  if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
    const error = new Error(`unsafe vision input ${key}`);
    error.code = 'VISION_INPUT_ACCESSOR_REJECTED';
    throw error;
  }
  return { present: true, value: descriptor.value };
}

function optionalStringProperty(object, key, fallback) {
  const entry = ownDataProperty(object, key);
  if (!entry.present || entry.value === undefined || entry.value === null || entry.value === '') return fallback;
  if (typeof entry.value !== 'string') {
    const error = new Error(`vision input ${key} must be string`);
    error.code = 'VISION_INPUT_TYPE_INVALID';
    throw error;
  }
  return entry.value;
}

function normalizeOcrText(value, { maxBytes = 4 * 1024 * 1024 } = {}) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    const error = new Error('OCR backend output must be string');
    error.code = 'VISION_OCR_OUTPUT_INVALID';
    throw error;
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    const error = new Error('OCR output byte limit must be a positive safe integer');
    error.code = 'VISION_OCR_OUTPUT_INVALID';
    throw error;
  }
  if (Buffer.byteLength(value, 'utf8') > maxBytes) {
    const error = new Error('OCR backend output exceeds byte limit');
    error.code = 'VISION_OCR_OUTPUT_INVALID';
    throw error;
  }
  return value;
}

function normalizeVisionOutput(value, {
  maxDepth = 16,
  maxNodes = 4096,
  maxStringBytes = 1024 * 1024,
  maxTotalStringBytes = 4 * 1024 * 1024,
  maxKeyBytes = 4096,
} = {}) {
  let nodes = 0;
  let totalStringBytes = 0;
  const seen = new Set();

  function accountString(entry) {
    const bytes = Buffer.byteLength(entry, 'utf8');
    if (bytes > maxStringBytes) throw invalid('vision backend output string exceeds byte limit');
    totalStringBytes += bytes;
    if (totalStringBytes > maxTotalStringBytes) throw invalid('vision backend output exceeds total string byte limit');
    return entry;
  }

  function visit(entry, depth) {
    if (entry === null || typeof entry === 'boolean') return entry;
    if (typeof entry === 'string') return accountString(entry);
    if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) throw invalid('vision backend output contains non-finite number');
      return entry;
    }
    if (entry === undefined) return null;
    if (typeof entry !== 'object') throw invalid('vision backend output must be JSON-safe data');
    if (depth > maxDepth) throw invalid('vision backend output exceeds depth limit');
    if (++nodes > maxNodes) throw invalid('vision backend output exceeds node limit');
    if (seen.has(entry)) throw invalid('vision backend output must not contain cycles');

    const prototype = Object.getPrototypeOf(entry);
    if (Array.isArray(entry)) {
      if (prototype !== Array.prototype) throw invalid('vision backend array prototype is unsafe');
    } else if (prototype !== Object.prototype && prototype !== null) {
      throw invalid('vision backend object prototype is unsafe');
    }

    seen.add(entry);
    try {
      if (Array.isArray(entry)) {
        const result = [];
        for (let index = 0; index < entry.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(entry, String(index));
          if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
            throw invalid('vision backend array contains unsafe accessor or sparse entry');
          }
          result.push(visit(descriptor.value, depth + 1));
        }
        return result;
      }

      const result = Object.create(null);
      for (const key of Object.keys(entry)) {
        if (Buffer.byteLength(key, 'utf8') > maxKeyBytes) {
          throw invalid('vision backend object key exceeds byte limit');
        }
        const descriptor = Object.getOwnPropertyDescriptor(entry, key);
        if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
          throw invalid('vision backend object contains unsafe accessor');
        }
        result[key] = visit(descriptor.value, depth + 1);
      }
      return result;
    } finally {
      seen.delete(entry);
    }
  }

  function invalid(message) {
    const error = new Error(message);
    error.code = 'VISION_MODEL_OUTPUT_INVALID';
    return error;
  }

  return visit(value, 0);
}

class VisionPipeline {
  constructor({ now = () => new Date().toISOString(), maxBytes = 32 * 1024 * 1024 } = {}) {
    this.now = now;
    this.maxBytes = maxBytes;
    this.active = null;
    this.history = [];
  }

  normalizeInput(input) {
    if (!input || typeof input !== 'object') throw new Error('vision input required');

    const bytesEntry = ownDataProperty(input, 'bytes');
    if (!bytesEntry.present || !Buffer.isBuffer(bytesEntry.value)) throw new Error('vision input bytes required');
    const rawBytes = bytesEntry.value;
    if (!rawBytes.length) throw new Error('empty vision input');
    if (rawBytes.length > this.maxBytes) throw new Error('vision input exceeds size limit');

    const kind = optionalStringProperty(input, 'kind', '').toLowerCase();
    if (!['image', 'file', 'screen'].includes(kind)) throw new Error('unsupported vision input kind');
    const mime = optionalStringProperty(input, 'mime', 'application/octet-stream').toLowerCase();
    const source = optionalStringProperty(input, 'source', kind);
    if (!source.trim() || /[\r\n\0]/.test(source)) throw new Error('unsafe vision input source');

    const bytes = Buffer.from(rawBytes);
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    return {
      kind,
      mime,
      bytes,
      sha256: digest,
      source,
      inputId: `vision_${crypto.createHash('sha256').update(JSON.stringify({ kind, mime, source, sha256: digest })).digest('hex').slice(0, 24)}`
    };
  }

  async analyze(input, { pressure = 'normal', visionModel, ocr } = {}) {
    const n = this.normalizeInput(input);
    if (pressure === 'critical') {
      return { ok: false, blocked: true, reason: 'host-critical-pressure', sha256: n.sha256 };
    }
    if (this.active) throw new Error('vision single-flight violation');

    const task = {
      id: crypto.randomUUID(),
      startedAt: this.now(),
      sha256: n.sha256,
      inputId: n.inputId,
      kind: n.kind
    };
    this.active = task;

    try {
      const canVision = typeof visionModel === 'function';
      const canOcr = typeof ocr === 'function';
      if (!canVision && !canOcr) throw new Error('no vision or OCR backend');

      const shouldOcr = n.kind === 'screen' || /pdf|image|png|jpe?g|webp|bmp/.test(n.mime);
      let vision = null;
      let text = '';
      const backends = [];
      const warnings = [];

      if (canVision) {
        try {
          vision = normalizeVisionOutput(await visionModel(cloneInput(n)));
          backends.push('vision-4b');
        } catch (error) {
          warnings.push({ backend: 'vision-4b', reason: String(error && error.message || error) });
        }
      }

      if (shouldOcr && canOcr) {
        try {
          text = normalizeOcrText(await ocr(cloneInput(n)));
          backends.push('windows-ocr');
        } catch (error) {
          warnings.push({ backend: 'windows-ocr', reason: String(error && error.message || error) });
        }
      }

      if (backends.length === 0) {
        const error = new Error('all applicable vision backends failed');
        error.code = 'VISION_BACKENDS_FAILED';
        error.backendFailures = warnings;
        throw error;
      }

      const result = {
        ok: true,
        degraded: warnings.length > 0,
        taskId: task.id,
        backend: backends.join('+'),
        kind: n.kind,
        source: n.source,
        sha256: n.sha256,
        inputId: n.inputId,
        text,
        vision,
        warnings,
        completedAt: this.now()
      };
      this.history.push({
        taskId: task.id,
        backend: result.backend,
        degraded: result.degraded,
        warnings: warnings.map((w) => ({ ...w })),
        sha256: n.sha256,
        inputId: n.inputId,
        completedAt: result.completedAt
      });
      return result;
    } finally {
      this.active = null;
    }
  }
}

function cloneInput(input) {
  return { ...input, bytes: Buffer.from(input.bytes) };
}

module.exports = { VisionPipeline, cloneInput, ownDataProperty, optionalStringProperty, normalizeOcrText, normalizeVisionOutput };
