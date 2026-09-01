'use strict';

const crypto = require('node:crypto');

const DEFAULT_MAX_TEXT_CONTEXT_BYTES = 128 * 1024;
const TEXT_ATTACHMENT_MIME = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/css',
  'text/javascript',
  'text/xml',
  'application/json',
  'application/javascript',
  'application/xml',
]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeAttachmentName(value) {
  const name = String(value || '').replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim();
  return name.slice(0, 180) || 'attachment';
}

function verifyAttachmentBytes(attachment, bytes) {
  if (!attachment || typeof attachment !== 'object') throw fail('ATTACHMENT_METADATA_INVALID', 'attachment metadata is required');
  const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (!data.length) throw fail('ATTACHMENT_BYTES_MISSING', 'attachment bytes are missing');
  if (!Number.isSafeInteger(attachment.bytes) || attachment.bytes < 1 || attachment.bytes !== data.length) {
    throw fail('ATTACHMENT_SIZE_MISMATCH', 'attachment byte count does not match persisted metadata');
  }
  if (typeof attachment.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(attachment.sha256)) {
    throw fail('ATTACHMENT_HASH_INVALID', 'attachment SHA-256 metadata is invalid');
  }
  const actualSha256 = crypto.createHash('sha256').update(data).digest('hex');
  if (actualSha256 !== attachment.sha256.toLowerCase()) {
    throw fail('ATTACHMENT_INTEGRITY_FAILED', 'attachment bytes do not match persisted SHA-256');
  }
  return { data, sha256: actualSha256 };
}

function buildVerifiedAttachmentContext({ attachment, bytes, maxTextBytes = DEFAULT_MAX_TEXT_CONTEXT_BYTES } = {}) {
  const verified = verifyAttachmentBytes(attachment, bytes);
  const name = normalizeAttachmentName(attachment.name);
  const type = String(attachment.type || 'application/octet-stream').toLowerCase();
  const header = `[Attachment: ${name} | ${type} | ${verified.data.length} bytes | SHA-256 ${verified.sha256}]`;

  if (!TEXT_ATTACHMENT_MIME.has(type)) {
    return Object.freeze({
      kind: 'metadata-only',
      text: `${header}\nBinary content is not injected into the text-model context.`,
      truncated: false,
      includedBytes: 0,
      totalBytes: verified.data.length,
      sha256: verified.sha256,
    });
  }

  const limit = Math.max(1024, Math.min(DEFAULT_MAX_TEXT_CONTEXT_BYTES, Number(maxTextBytes) || DEFAULT_MAX_TEXT_CONTEXT_BYTES));
  const included = verified.data.subarray(0, limit);
  const truncated = included.length < verified.data.length;
  const body = included.toString('utf8').replace(/\u0000/g, '');
  const suffix = truncated ? `\n[Attachment truncated after ${included.length} of ${verified.data.length} bytes.]` : '';

  return Object.freeze({
    kind: 'text',
    text: `${header}\n${body}${suffix}`,
    truncated,
    includedBytes: included.length,
    totalBytes: verified.data.length,
    sha256: verified.sha256,
  });
}

module.exports = {
  DEFAULT_MAX_TEXT_CONTEXT_BYTES,
  TEXT_ATTACHMENT_MIME,
  normalizeAttachmentName,
  verifyAttachmentBytes,
  buildVerifiedAttachmentContext,
};
