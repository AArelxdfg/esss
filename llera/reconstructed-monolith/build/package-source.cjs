'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const archiver = require('archiver');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist');
const outFile = path.join(outDir, 'LLera_MONOLITH_OMEGA_Reconstructed_Source.zip');

fs.mkdirSync(outDir, { recursive: true });

function withinRoot(candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

if (!withinRoot(outFile)) throw new Error('source archive output escaped project root');
if (fs.existsSync(outFile)) fs.rmSync(outFile, { force: true });

const output = fs.createWriteStream(outFile, { flags: 'wx' });
const archive = archiver('zip', { zlib: { level: 9 } });

archive.on('warning', (error) => {
  if (error.code !== 'ENOENT') throw error;
});
archive.on('error', (error) => {
  output.destroy(error);
});

output.on('close', () => {
  const bytes = fs.readFileSync(outFile);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  process.stdout.write(`${outFile}\nbytes=${bytes.length}\nsha256=${sha256}\n`);
});

archive.pipe(output);
archive.glob('**/*', {
  cwd: root,
  dot: true,
  ignore: [
    'node_modules/**',
    'dist/**',
    '.git/**',
    '*.log',
  ],
});
archive.finalize();
