'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { IntegritySentinel, sha256Bytes } = require('../src/integrity-sentinel');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llera-integrity-'));
const root = path.join(tmp, 'root');
const outside = path.join(tmp, 'outside');
fs.mkdirSync(root, { recursive: true });
fs.mkdirSync(outside, { recursive: true });

const trusted = Buffer.from('inside-root');
fs.writeFileSync(path.join(root, 'inside.bin'), trusted);
const outsideBytes = Buffer.from('outside-root-secret');
fs.writeFileSync(path.join(outside, 'outside.bin'), outsideBytes);

const sentinel = new IntegritySentinel({ rootDir: root });
const normal = sentinel.verifyFile({ path: 'inside.bin', sha256: sha256Bytes(trusted), size: trusted.length });
assert.equal(normal.ok, true);

let symlinkCreated = false;
try {
  fs.symlinkSync(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  symlinkCreated = true;
} catch (error) {
  if (process.platform !== 'win32') throw error;
}

if (symlinkCreated) {
  const escaped = sentinel.verifyFile({ path: path.join('escape', 'outside.bin'), sha256: sha256Bytes(outsideBytes), size: outsideBytes.length });
  assert.equal(escaped.ok, false);
  assert.equal(escaped.reason, 'unsafe-path');

  const quarantine = sentinel.quarantine(path.join('escape', 'outside.bin'), 'adversarial-test');
  assert.equal(quarantine.moved, false);
  assert.equal(quarantine.reason, 'unsafe-path');
  assert.equal(fs.readFileSync(path.join(outside, 'outside.bin'), 'utf8'), 'outside-root-secret');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('INTEGRITY_SENTINEL_SYMLINK_ESCAPE_PASS');
