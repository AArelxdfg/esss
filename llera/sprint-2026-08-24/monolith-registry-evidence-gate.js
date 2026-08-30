#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const EXEC_EXT = /\.(?:js|cjs|mjs|ts|tsx)$/i;
const TOOL_HINT = /\b(?:description|execute|handler|run|invoke|inputSchema|input_schema|parameters|argsSchema|schema)\b/;
const NAME_RE = /\bname\s*:\s*["'`]([a-z][a-z0-9_]{2,63})["'`]/gi;

function walk(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, ent.name);
    if (ent.isDirectory()) {
      if (!['node_modules', '.git', 'dist', 'build', 'out'].includes(ent.name)) out.push(...walk(p));
    } else if (EXEC_EXT.test(ent.name)) out.push(p);
  }
  return out;
}

function objectWindow(text, index, maxSpan = 1200) {
  const start = text.lastIndexOf('{', index);
  const end = text.indexOf('}', index);
  if (start < 0 || end < 0 || end <= start || (end - start) > maxSpan) return '';
  return text.slice(start, end + 1);
}

function scan(root) {
  const evidence = [];
  const names = new Set();

  for (const file of walk(root)) {
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }

    let m;
    NAME_RE.lastIndex = 0;
    while ((m = NAME_RE.exec(text))) {
      const window = objectWindow(text, m.index);
      if (!TOOL_HINT.test(window)) continue;
      names.add(m[1]);
      evidence.push({
        name: m[1],
        file: path.relative(root, file),
        offset: m.index
      });
    }
  }

  return {
    root: path.resolve(root),
    executableFilesScanned: walk(root).length,
    verifiedToolLikeNames: [...names].sort(),
    verifiedToolLikeCount: names.size,
    evidence
  };
}

function selfTest() {
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llera-registry-evidence-'));
  try {
    fs.writeFileSync(path.join(tmp, 'real.js'), `
      const tools = [
        { name: 'read_file', description: 'read a file', execute: async () => {} },
        { name: 'write_file', inputSchema: {}, handler: async () => {} }
      ];
      const app = { name: 'LLera' };
      const model = { name: 'qwen3_next_80b' };
    `);

    fs.writeFileSync(path.join(tmp, 'decoy.js'), `
      const menus = [
        { name: 'fake_tool_01', label: 'Settings' },
        { name: 'fake_tool_02', label: 'About' }
      ];
    `);

    fs.writeFileSync(path.join(tmp, 'docs.md'), `
      { name: 'fake_tool_03', description: 'documentation only', execute: 'never' }
    `);

    const r = scan(tmp);
    const names = new Set(r.verifiedToolLikeNames);
    if (!names.has('read_file') || !names.has('write_file')) {
      throw new Error('real tool objects were not detected');
    }
    if (names.has('fake_tool_01') || names.has('fake_tool_02') || names.has('fake_tool_03')) {
      throw new Error(`decoy polluted registry evidence: ${JSON.stringify(r)}`);
    }
    if (names.has('llera') || names.has('qwen3_next_80b')) {
      throw new Error(`generic name fields polluted registry evidence: ${JSON.stringify(r)}`);
    }

    console.log(JSON.stringify({
      selfTest: 'PASS',
      realToolObjectDetection: 'PASS',
      genericNameIsolation: 'PASS',
      executableOnlyIsolation: 'PASS',
      verifiedToolLikeCount: r.verifiedToolLikeCount
    }, null, 2));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const root = process.argv[2] || process.cwd();
  console.log(JSON.stringify(scan(root), null, 2));
}
