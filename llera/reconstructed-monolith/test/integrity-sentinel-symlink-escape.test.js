'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { IntegritySentinel, sha256Bytes } = require('../src/integrity-sentinel');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'llera-integrity-'));
const root = path.join(temp, 'root');
const outside = path.join(temp, 'outside');
fs.mkdirSync(root, { recursive: true });
fs.mkdirSync(outside, { recursive: true });

try {
  const safeBytes = Buffer.from('trusted-inside-root');
  fs.writeFileSync(path.join(root, 'safe.bin'), safeBytes);
  const sentinel = new IntegritySentinel({ rootDir: root });

  const safe = sentinel.verifyFile({ path: 'safe.bin', sha256: sha256Bytes(safeBytes), size: safeBytes.length });
  assert.equal(safe.ok, true, 'ordinary in-root files must remain verifiable');

  assert.throws(() => sentinel.resolveSafe('../outside/secret.bin'), /path escape blocked/, 'lexical traversal must remain blocked');

  const outsideBytes = Buffer.from('must-never-be-trusted-through-link');
  const outsideFile = path.join(outside, 'secret.bin');
  fs.writeFileSync(outsideFile, outsideBytes);
  const link = path.join(root, 'linked.bin');

  let symlinkCreated = true;
  try {
    fs.symlinkSync(outsideFile, link, 'file');
  } catch (error) {
    if (error && ['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) symlinkCreated = false;
    else throw error;
  }

  if (symlinkCreated) {
    const escaped = sentinel.verifyFile({ path: 'linked.bin', sha256: sha256Bytes(outsideBytes), size: outsideBytes.length });
    assert.equal(escaped.ok, false);
    assert.equal(escaped.reason, 'symlink-escape', 'matching bytes outside root must not satisfy a manifest through a symlink');

    const quarantine = sentinel.quarantine('linked.bin');
    assert.equal(quarantine.moved, false, 'sentinel must not rename an external symlink target');
    assert.equal(quarantine.reason, 'symlink-escape');
    assert.equal(fs.readFileSync(outsideFile, 'utf8'), outsideBytes.toString('utf8'), 'external target must remain untouched');
  }

  console.log(`integrity-sentinel-symlink-escape PASS${symlinkCreated ? '' : ' (symlink case skipped: host permission)'}`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
