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
          vision = await visionModel(cloneInput(n));
          backends.push('vision-4b');
        } catch (error) {
          warnings.push({ backend: 'vision-4b', reason: String(error && error.message || error) });
        }
      }

      if (shouldOcr && canOcr) {
        try {
          text = String(await ocr(cloneInput(n)) || '');
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

module.exports = { VisionPipeline, cloneInput, ownDataProperty, optionalStringProperty };
