'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

test('reconstructed desktop build project is explicit and fail-closed about historical identity', () => {
  const pkg = readJson('package.json');
  assert.equal(pkg.private, true);
  assert.equal(pkg.main, 'app/main.cjs');
  assert.match(pkg.version, /reconstructed/);
  assert.ok(pkg.scripts['dist:win']);
  assert.ok(pkg.scripts['source:zip']);
  assert.deepEqual(pkg.build.win.target[0].arch, ['x64']);
  assert.equal(pkg.build.nsis.oneClick, false);
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false);

  for (const rel of [
    'app/main.cjs',
    'app/preload.cjs',
    'app/index.html',
    'app/renderer.js',
    'build/package-source.cjs',
  ]) {
    assert.equal(fs.existsSync(path.join(root, rel)), true, `${rel} must exist`);
  }

  const main = fs.readFileSync(path.join(root, 'app/main.cjs'), 'utf8');
  assert.match(main, /exactHistoricalV54:\s*false/);
  assert.match(main, /historicalClaimAllowed:\s*false/);
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
});
