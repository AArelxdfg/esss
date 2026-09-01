'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {
  DEFAULT_MAX_TEXT_CONTEXT_BYTES,
  buildVerifiedAttachmentContext,
  verifyAttachmentBytes,
} = require('../src/attachment-context');

function fixture(content, type = 'text/plain', name = 'notes.txt') {
  const bytes = Buffer.from(content);
  return {
    bytes,
    attachment: {
      id: 'att_fixture',
      name,
      type,
      bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    },
  };
}

test('verified text attachments bind exact bytes and SHA-256 into model context', () => {
  const { attachment, bytes } = fixture('MONOLITH TEST\nsecond line');
  const result = buildVerifiedAttachmentContext({ attachment, bytes });
  assert.equal(result.kind, 'text');
  assert.equal(result.truncated, false);
  assert.equal(result.includedBytes, bytes.length);
  assert.match(result.text, /MONOLITH TEST/);
  assert.match(result.text, new RegExp(attachment.sha256));
});

test('attachment context fails closed when persisted bytes are tampered', () => {
  const { attachment } = fixture('trusted bytes');
  assert.throws(
    () => verifyAttachmentBytes(attachment, Buffer.from('tampered bytes')),
    error => error && ['ATTACHMENT_SIZE_MISMATCH', 'ATTACHMENT_INTEGRITY_FAILED'].includes(error.code),
  );
});

test('attachment context fails closed when metadata SHA-256 is malformed', () => {
  const { attachment, bytes } = fixture('trusted bytes');
  attachment.sha256 = 'not-a-hash';
  assert.throws(() => verifyAttachmentBytes(attachment, bytes), error => error?.code === 'ATTACHMENT_HASH_INVALID');
});

test('binary attachments remain metadata-only and are never decoded into text-model context', () => {
  const { attachment, bytes } = fixture('%PDF-1.7 fake bytes', 'application/pdf', 'manual.pdf');
  const result = buildVerifiedAttachmentContext({ attachment, bytes });
  assert.equal(result.kind, 'metadata-only');
  assert.equal(result.includedBytes, 0);
  assert.match(result.text, /Binary content is not injected/);
  assert.doesNotMatch(result.text, /%PDF-1\.7/);
});

test('large text attachments are deterministically bounded before model-context injection', () => {
  const content = 'x'.repeat(DEFAULT_MAX_TEXT_CONTEXT_BYTES + 4096);
  const { attachment, bytes } = fixture(content);
  const result = buildVerifiedAttachmentContext({ attachment, bytes });
  assert.equal(result.truncated, true);
  assert.equal(result.includedBytes, DEFAULT_MAX_TEXT_CONTEXT_BYTES);
  assert.equal(result.totalBytes, bytes.length);
  assert.match(result.text, /Attachment truncated/);
});
