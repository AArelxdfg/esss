'use strict';

const crypto = require('node:crypto');

const SUPPORTED_IMAGE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/bmp',
]);

const DEFAULT_MAX_IMAGE_BYTES = 25 * 1024 * 1024;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function hasPlainDataProperty(object, key) {
  if (!object || typeof object !== 'object') return false;
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return Boolean(descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value'));
}

function assertPlainMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw fail('VISION_METADATA_INVALID', 'vision input metadata must be a plain object');
  }
  for (const key of ['id', 'name', 'type', 'bytes', 'sha256', 'sourceKind']) {
    if (!hasPlainDataProperty(metadata, key)) {
      throw fail('VISION_METADATA_INVALID', `vision metadata field ${key} must be a direct data property`);
    }
  }
}

function normalizeSourceKind(value) {
  if (value === 'image-file' || value === 'clipboard-image' || value === 'screen-capture') return value;
  throw fail('VISION_SOURCE_INVALID', 'vision sourceKind is unsupported');
}

function verifyVisionInput({ metadata, bytes, maxBytes = DEFAULT_MAX_IMAGE_BYTES } = {}) {
  assertPlainMetadata(metadata);
  // Always detach the verified payload from caller-owned memory. Keeping a caller
  // Buffer here creates a TOCTOU window where bytes can be mutated after their
  // SHA-256 has been checked but before OCR/vision consumes them.
  let data;
  try {
    data = Buffer.from(bytes || []);
  } catch (_) {
    throw fail('VISION_BYTES_INVALID', 'vision input bytes are invalid');
  }
  const byteLimit = Number.isSafeInteger(maxBytes) && maxBytes > 0 ? maxBytes : DEFAULT_MAX_IMAGE_BYTES;

  if (!data.length) throw fail('VISION_BYTES_MISSING', 'vision input bytes are missing');
  if (data.length > byteLimit) throw fail('VISION_BYTES_TOO_LARGE', 'vision input exceeds the configured byte limit');
  if (!Number.isSafeInteger(metadata.bytes) || metadata.bytes !== data.length || metadata.bytes < 1) {
    throw fail('VISION_SIZE_MISMATCH', 'vision input byte count does not match persisted metadata');
  }
  if (typeof metadata.id !== 'string' || !metadata.id.trim()) throw fail('VISION_ID_INVALID', 'vision input id is required');
  if (typeof metadata.name !== 'string' || !metadata.name.trim()) throw fail('VISION_NAME_INVALID', 'vision input name is required');
  if (typeof metadata.type !== 'string' || !SUPPORTED_IMAGE_MIME.has(metadata.type.toLowerCase())) {
    throw fail('VISION_MIME_UNSUPPORTED', 'vision input MIME type is unsupported');
  }
  if (typeof metadata.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(metadata.sha256)) {
    throw fail('VISION_HASH_INVALID', 'vision input SHA-256 metadata is invalid');
  }

  const sourceKind = normalizeSourceKind(metadata.sourceKind);
  const actualSha256 = crypto.createHash('sha256').update(data).digest('hex');
  if (actualSha256 !== metadata.sha256.toLowerCase()) {
    throw fail('VISION_INTEGRITY_FAILED', 'vision input bytes do not match persisted SHA-256');
  }

  return Object.freeze({
    id: metadata.id,
    name: metadata.name,
    type: metadata.type.toLowerCase(),
    sourceKind,
    bytes: data.length,
    sha256: actualSha256,
    data,
  });
}

function buildOcrRequest({ metadata, bytes, maxBytes } = {}) {
  const verified = verifyVisionInput({ metadata, bytes, maxBytes });
  return Object.freeze({
    schema: 1,
    inputId: verified.id,
    sourceKind: verified.sourceKind,
    name: verified.name,
    mime: verified.type,
    bytes: verified.bytes,
    sha256: verified.sha256,
    // Give the consumer its own detached copy as well, so mutation of a
    // previously returned verification snapshot cannot rewrite this request.
    payload: Buffer.from(verified.data),
  });
}

module.exports = {
  SUPPORTED_IMAGE_MIME,
  DEFAULT_MAX_IMAGE_BYTES,
  verifyVisionInput,
  buildOcrRequest,
};