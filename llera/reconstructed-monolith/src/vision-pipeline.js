'use strict';
const crypto = require('crypto');

const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

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
    if (!input || typeof input !== 'object' || Array.isArray(input) || !Buffer.isBuffer(input.bytes)) {
      throw new Error('vision input bytes required');
    }
    if (!input.bytes.length) throw new Error('empty vision input');
    if (input.bytes.length > this.maxBytes) throw new Error('vision input exceeds size limit');
    if (typeof input.kind !== 'string') throw new Error('vision input kind must be a string');
    const kind = input.kind.toLowerCase();
    if (!['image', 'file', 'screen'].includes(kind)) throw new Error('unsupported vision input kind');
    if (input.mime !== undefined && typeof input.mime !== 'string') throw new Error('vision input mime must be a string');
    const mime = (input.mime || 'application/octet-stream').toLowerCase();
    if (input.source !== undefined && typeof input.source !== 'string') throw new Error('vision input source must be a string');
    const source = input.source || kind;
    if (!source.trim() || /[\r\n\0]/.test(source)) throw new Error('unsafe vision input source');
    const bytes = Buffer.from(input.bytes);
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
    if (pressure === 'critical') {
      return {
        ok: false,
        blocked: true,
        reason: 'host-critical-pressure',
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
          const ocrResult = await ocr(cloneInput(n));
          if (typeof ocrResult !== 'string') {
            const error = new TypeError('OCR backend must return a string');
            error.code = 'VISION_OCR_RESULT_INVALID';
            throw error;
          }
          text = ocrResult;
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

function cloneInput(input) {
  return {...input, bytes:Buffer.from(input.bytes)};
}

module.exports = { VisionPipeline, cloneInput, DEFAULT_MAX_BYTES };
