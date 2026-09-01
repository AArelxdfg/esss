'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildSourceProvenance } = require('../src/source-provenance-manifest');

async function main() {
  const rootDir = path.resolve(__dirname, '..');
  const manifest = await buildSourceProvenance({ rootDir, createdAt: null, ignores: ['.git', 'node_modules', 'dist', 'out', 'build', '.DS_Store'] });
  manifest.branch = process.env.LLERA_BRANCH || null;
  manifest.head = process.env.LLERA_HEAD || null;
  const destination = path.resolve(rootDir, '..', 'final-evidence', 'CURRENT_SOURCE_MANIFEST.json');
  fs.writeFileSync(destination, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${destination}\nfiles=${manifest.fileCount}\nbytes=${manifest.totalBytes}\n`);
}

main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
