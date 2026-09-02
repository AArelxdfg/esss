'use strict';

const assert = require('node:assert');
const { validateManifest, validateManifestPath } = require('../src/integrity-sentinel');

const hash = 'a'.repeat(64);
const entry = (filePath) => ({ path: filePath, sha256: hash, size: 1 });

assert.deepStrictEqual(validateManifestPath('bin/llera.exe'), { ok: true, normalizedPath: 'bin/llera.exe' });

for (const [filePath, reason] of [
  ['../llera.exe', 'non-canonical-path'],
  ['bin/../llera.exe', 'non-canonical-path'],
  ['./llera.exe', 'non-canonical-path'],
  ['/absolute/llera.exe', 'absolute-path'],
  ['C:\\LLera\\llera.exe', 'absolute-path'],
  ['bin//llera.exe', 'non-canonical-path'],
  ['bin/llera.exe\0shadow', 'path-nul-byte'],
]) {
  const result = validateManifest({ files: [entry(filePath)] });
  assert.strictEqual(result.ok, false, `${filePath} must fail closed`);
  assert.ok(result.failures.some((failure) => failure.reason === reason), `${filePath} must fail as ${reason}`);
}

const alias = validateManifest({ files: [entry('Bin/LLera.exe'), entry('bin/llera.exe')] });
assert.strictEqual(alias.ok, false);
assert.ok(alias.failures.some((failure) => failure.reason === 'windows-path-alias'));

const nonString = validateManifest({ files: [{ ...entry('llera.exe'), path: 42 }] });
assert.strictEqual(nonString.ok, false);
assert.ok(nonString.failures.some((failure) => failure.reason === 'path-string-required'));

console.log('MONOLITH integrity manifest path policy PASS');
