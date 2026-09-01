'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('default desktop product has zero legacy UI copy and a new conversation-first frame', () => {
  const html = read('app/index.html'); const renderer = read('app/renderer.js'); const css = read('app/styles.css');
  for (const forbidden of ['AURORA contract self-test', 'reconstructed candidate', 'not exact historical V5.4', 'runtime wiring remains', 'desktop packaging is wired']) assert.equal(`${html}\n${renderer}`.toLowerCase().includes(forbidden.toLowerCase()), false, `forbidden legacy copy: ${forbidden}`);
  for (const required of ['conversation-list', 'transcript', 'composer-surface', 'context-drawer', 'command-palette', 'model-menu', 'settings-open']) assert.match(html, new RegExp(`id="${required}"|class="[^"]*${required}`));
  assert.match(css, /--reading-w:\s*824px/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(html, /assets\/llera-logo\.png/);
});

test('renderer contracts cover keyboard, attachments, work, streaming, and recovery surfaces', () => {
  const renderer = read('app/renderer.js'); const preload = read('app/preload.cjs');
  for (const contract of ['compositionstart', 'shiftKey', 'dragenter', 'clipboardData', 'stopGeneration', "setMode('work')", 'message.delta', 'openDrawer(\'mission\'', 'openPalette', 'closePalette']) assert.match(renderer, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const bridge of ['message:send', 'message:stop', 'attachment:add', 'mission:create', 'settings:update', 'llera:event']) assert.match(preload, new RegExp(bridge.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('desktop security and design tokens remain explicit', () => {
  const main = read('app/main.cjs'); const css = read('app/styles.css');
  for (const setting of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true', 'webSecurity: true', 'allowRunningInsecureContent: false']) assert.match(main, new RegExp(setting.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const token of ['--bg-canvas', '--bg-sidebar', '--text-primary', '--accent', '--danger', '--shadow-float', '--sidebar-w', '--drawer-w', '--motion-base']) assert.match(css, new RegExp(token));
  assert.doesNotMatch(preloadCapabilities(main), /shell|exec|arbitrary|readFile|writeFile/i);
});

function preloadCapabilities(main) { return `${main}\n${read('app/preload.cjs')}`; }
