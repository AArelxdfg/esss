'use strict';
const crypto = require('crypto');

const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
const ALLOWED_PRESSURES = new Set(['normal', 'elevated', 'critical']);

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

function requiredStringProperty(object, key) {
  const entry = ownDataProperty(object, key);
  if (!entry.present || typeof entry.value !== 'string') {
    const error = new Error(`vision input ${key} must be a string`);
    error.code = 'VISION_INPUT_TYPE_INVALID';
    throw error;
  }
  return entry.value;
}

function optionalStringProperty(object, key, fallback) {
  const entry = ownDataProperty(object, key);
  if (!entry.present || entry.value === undefined || entry.value === null || entry.value === '') return fallback;
  if (typeof entry.value !== 'string') {
    const error = new Error(`vision input ${key} must be a string`);
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

class VisionPipeline {
  constructor({ now = () => new Date().toISOString(), maxBytes = DEFAULT_MAX_BYTES } = {}) {
    if (typeof now !== 'function') {
      const error = new TypeError('vision clock must be a function');
      error.code = 'VISION_CLOCK_INVALID';
      throw error;
    }
    if (typeof maxBytes !== 'number' || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      const error = new RangeError('vision maxBytes must be a positive safe integer');
      error.code = 'VISION_MAX_BYTES_INVALID';
      throw error;
    }
    this.now = now;
    this.maxBytes = maxBytes;
    this.active = null;
    this.history = [];
  }

  normalizeInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('vision input bytes required');
    }
    const bytesEntry = ownDataProperty(input, 'bytes');
    if (!bytesEntry.present || !Buffer.isBuffer(bytesEntry.value)) throw new Error('vision input bytes required');
    const rawBytes = bytesEntry.value;
    if (!rawBytes.length) throw new Error('empty vision input');
    if (rawBytes.length > this.maxBytes) throw new Error('vision input exceeds size limit');

    const kind = requiredStringProperty(input, 'kind').toLowerCase();
    if (!['image', 'file', 'screen'].includes(kind)) throw new Error('unsupported vision input kind');
    const mime = optionalStringProperty(input, 'mime', 'application/octet-stream').toLowerCase();
    const source = optionalStringProperty(input, 'source', kind);
    if (!source.trim() || /[\r\n\0]/.test(source)) throw new Error('unsafe vision input source');

    const bytes = Buffer.from(rawBytes);
    const byteCount = bytes.length;
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    return {
      kind,
      mime,
      bytes,
      byteCount,
      sha256: digest,
      source,
      inputId: `vision_${crypto.createHash('sha256').update(JSON.stringify({kind,mime,source,sha256:digest,byteCount})).digest('hex').slice(0, 24)}`
    };
  }

  async analyze(input, { pressure = 'normal', visionModel, ocr } = {}) {
    const n = this.normalizeInput(input);
    const normalizedPressure = normalizePressure(pressure);
    if (normalizedPressure === 'critical') {
      return {
        ok: false,
        blocked: true,
        reason: 'host-critical-pressure',
        pressure: normalizedPressure,
        inputId: n.inputId,
        sha256: n.sha256,
        byteCount: n.byteCount
      };
    }
    if (this.active) throw new Error('vision single-flight violation');

    const task = {
      id: crypto.randomUUID(),
      startedAt: this.now(),
      sha256: n.sha256,
      byteCount: n.byteCount,
      inputId: n.inputId,
      kind: n.kind,
      pressure: normalizedPressure
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
        pressure: normalizedPressure,
        sha256: n.sha256,
        byteCount: n.byteCount,
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
        pressure: normalizedPressure,
        sha256: n.sha256,
        byteCount: n.byteCount,
        inputId: n.inputId,
        completedAt: result.completedAt
      });
      return result;
    } finally {
      this.active = null;
    }
  }
}

function normalizePressure(value) {
  if (typeof value !== 'string') {
    const error = new TypeError('vision pressure must be a string');
    error.code = 'VISION_PRESSURE_INVALID';
    throw error;
  }
  const pressure = value.toLowerCase();
  if (!ALLOWED_PRESSURES.has(pressure)) {
    const error = new Error('unsupported vision pressure');
    error.code = 'VISION_PRESSURE_INVALID';
    throw error;
  }
  return pressure;
}

function cloneInput(input) {
  return {...input, bytes:Buffer.from(input.bytes)};
}

module.exports = {
  VisionPipeline,
  cloneInput,
  DEFAULT_MAX_BYTES,
  normalizePressure,
  ownDataProperty,
  requiredStringProperty,
  optionalStringProperty,
  normalizeOcrText
};
