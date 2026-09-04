'use strict';

const assert = require('assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  IntegritySentinel,
  sha256Bytes,
  canonicalManifestPayload,
} = require('../src/integrity-sentinel');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llera-integrity-'));
try {
  const payload = Buffer.from('MONOLITH INTEGRITY TEST');
  const filePath = path.join(root, 'payload.bin');
  fs.writeFileSync(filePath, payload);

  const sentinel = new IntegritySentinel({ rootDir: root });
  const valid = {
    schema: 1,
    product: 'LLera',
    version: 'reconstructed',
    files: [{
      path: 'payload.bin',
      sha256: sha256Bytes(payload),
      size: payload.length,
    }],
  };

  const tree = sentinel.verifyTree(valid);
  assert.strictEqual(tree.ok, true);
  assert.strictEqual(tree.checked, 1);
  assert.strictEqual(sentinel.assertTrusted(valid).trusted, true);
  assert.ok(canonicalManifestPayload(valid).includes('payload.bin'));

  let coercions = 0;
  const coercivePath = {
    path: { toString() { coercions += 1; return 'payload.bin'; } },
    sha256: sha256Bytes(payload),
    size: payload.length,
  };
  const pathResult = sentinel.verifyTree({ files: [coercivePath] });
  assert.strictEqual(pathResult.ok, false);
  assert.strictEqual(pathResult.failures[0].reason, 'manifest-invalid');
  assert.strictEqual(coercions, 0);

  const coerciveSha = {
    path: 'payload.bin',
    sha256: { toString() { coercions += 1; return sha256Bytes(payload); } },
    size: payload.length,
  };
  const shaResult = sentinel.verifyTree({ files: [coerciveSha] });
  assert.strictEqual(shaResult.ok, false);
  assert.strictEqual(coercions, 0);

  const coerciveSize = {
    path: 'payload.bin',
    sha256: sha256Bytes(payload),
    size: { valueOf() { coercions += 1; return payload.length; } },
  };
  const sizeResult = sentinel.verifyTree({ files: [coerciveSize] });
  assert.strictEqual(sizeResult.ok, false);
  assert.strictEqual(coercions, 0);

  const accessor = {};
  Object.defineProperty(accessor, 'path', {
    enumerable: true,
    get() { coercions += 1; return 'payload.bin'; },
  });
  accessor.sha256 = sha256Bytes(payload);
  accessor.size = payload.length;
  const accessorResult = sentinel.verifyTree({ files: [accessor] });
  assert.strictEqual(accessorResult.ok, false);
  assert.strictEqual(coercions, 0);

  const forgedSchema = {
    schema: { valueOf() { coercions += 1; return 1; } },
    files: valid.files,
  };
  const schemaResult = sentinel.verifyTree(forgedSchema);
  assert.strictEqual(schemaResult.ok, false);
  assert.strictEqual(coercions, 0);

  const directEntry = sentinel.verifyFile(coercivePath);
  assert.strictEqual(directEntry.ok, false);
  assert.strictEqual(directEntry.reason, 'manifest-entry-invalid');
  assert.strictEqual(coercions, 0);

  console.log('MONOLITH integrity sentinel coercion boundary PASS', {
    validTree:true,
    coercivePathRejected:true,
    coerciveShaRejected:true,
    coerciveSizeRejected:true,
    accessorRejected:true,
    coerciveSchemaRejected:true,
  });
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
