'use strict';
const crypto = require('crypto');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalInputIdentity({ kind, mime, source, sha256: bytesSha256 }) {
  return sha256(Buffer.from(JSON.stringify({
    schema: 'llera.vision.input.v1',
    kind,
    mime,
    source,
    bytesSha256
  }), 'utf8'));
}

class VisionPipeline {
  constructor({ now = () => new Date().toISOString(), maxBytes = 32 * 1024 * 1024, maxSourceLength = 2048 } = {}) {
    this.now = now;
    this.maxBytes = maxBytes;
    this.maxSourceLength = maxSourceLength;
    this.active = null;
    this.history = [];
  }

  normalizeInput(input) {
    if (!input || !Buffer.isBuffer(input.bytes)) throw new Error('vision input bytes required');
    if (!input.bytes.length) throw new Error('empty vision input');
    if (input.bytes.length > this.maxBytes) throw new Error('vision input exceeds size limit');
    const kind = String(input.kind || '').toLowerCase();
    if (!['image', 'file', 'screen'].includes(kind)) throw new Error('unsupported vision input kind');
    const mime = String(input.mime || 'application/octet-stream').trim().toLowerCase();
    if (!mime || /[\r\n\0]/.test(mime)) throw new Error('invalid vision input mime');
    const source = String(input.source || kind).trim();
    if (!source || source.length > this.maxSourceLength || /[\r\n\0]/.test(source)) {
      throw new Error('invalid vision input source');
    }
    const bytes = Buffer.from(input.bytes);
    const bytesSha256 = sha256(bytes);
    const inputId = canonicalInputIdentity({ kind, mime, source, sha256: bytesSha256 });
    return {
      kind,
      mime,
      bytes,
      sha256: bytesSha256,
      inputId,
      source
    };
  }

  backendInput(n) {
    return {
      kind: n.kind,
      mime: n.mime,
      bytes: Buffer.from(n.bytes),
      sha256: n.sha256,
      inputId: n.inputId,
      source: n.source
    };
  }

  async analyze(input, { pressure = 'normal', visionModel, ocr } = {}) {
    const n = this.normalizeInput(input);
    if (pressure === 'critical') {
      return { ok: false, blocked: true, reason: 'host-critical-pressure', sha256: n.sha256, inputId: n.inputId };
    }
    if (this.active) throw new Error('vision single-flight violation');

    const task = {
      id: crypto.randomUUID(),
      startedAt: this.now(),
      sha256: n.sha256,
      inputId: n.inputId,
      kind: n.kind,
      mime: n.mime,
      source: n.source
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
          vision = await visionModel(this.backendInput(n));
          backends.push('vision-4b');
        } catch (error) {
          warnings.push({ backend: 'vision-4b', reason: String(error && error.message || error) });
        }
      }

      if (shouldOcr && canOcr) {
        try {
          text = String(await ocr(this.backendInput(n)) || '');
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
        mime: n.mime,
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
        kind: n.kind,
        mime: n.mime,
        source: n.source,
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

module.exports = { VisionPipeline, canonicalInputIdentity };
