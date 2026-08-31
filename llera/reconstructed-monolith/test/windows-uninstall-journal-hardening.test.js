'use strict';
const assert = require('assert');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { WindowsUninstallTransaction } = require('../src/windows-uninstall-transaction');

async function writeJournal(root, value) {
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, 'uninstall-journal.json'), JSON.stringify(value), 'utf8');
}

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'llera-uninstall-hardening-'));
  const tx = new WindowsUninstallTransaction({ rootDir: root });

  await writeJournal(root, {
    schema: 3,
    state: 'uninstalling',
    keepData: true,
    keepModels: true,
    completed: ['stop-app'],
    at: 1
  });

  await assert.rejects(
    () => tx.begin({ keepData: false, keepModels: false }),
    /already in progress/,
    'new begin must not overwrite an active destructive intent'
  );

  let journal = JSON.parse(await fs.readFile(path.join(root, 'uninstall-journal.json'), 'utf8'));
  assert.strictEqual(journal.keepData, true);
  assert.strictEqual(journal.keepModels, true);
  assert.deepStrictEqual(journal.completed, ['stop-app']);

  await fs.mkdir(path.join(root, 'data'), { recursive: true });
  await fs.mkdir(path.join(root, 'models'), { recursive: true });
  await fs.writeFile(path.join(root, 'data', 'sentinel.txt'), 'data');
  await fs.writeFile(path.join(root, 'models', 'sentinel.txt'), 'models');
  await writeJournal(root, {
    schema: 3,
    state: 'uninstalling',
    keepData: false,
    keepModels: false,
    completed: ['stop-app'],
    at: 1
  });
  await assert.rejects(() => tx.resume(), /explicit data deletion confirmation/);
  assert.strictEqual(await fs.readFile(path.join(root, 'data', 'sentinel.txt'), 'utf8'), 'data');
  assert.strictEqual(await fs.readFile(path.join(root, 'models', 'sentinel.txt'), 'utf8'), 'models');

  await writeJournal(root, {
    schema: 3,
    state: 'uninstalling',
    keepData: true,
    keepModels: true,
    completed: ['stop-app', 'made-up-destructive-step'],
    at: 1
  });
  await assert.rejects(() => tx.resume(), /steps invalid/);

  await writeJournal(root, {
    schema: 3,
    state: 'uninstalling',
    keepData: true,
    keepModels: true,
    completed: ['stop-app', 'stop-app'],
    at: 1
  });
  await assert.rejects(() => tx.resume(), /steps invalid/);

  await writeJournal(root, {
    schema: 3,
    state: 'uninstalling',
    keepData: true,
    keepModels: true,
    completed: ['stop-app', 'remove-shortcuts'],
    at: 1
  });
  await assert.rejects(() => tx.resume(), /shortcut completion inconsistent/);

  await writeJournal(root, {
    schema: 99,
    state: 'uninstalling',
    keepData: true,
    keepModels: true,
    completed: [],
    at: 1
  });
  await assert.rejects(() => tx.resume(), /schema unsupported/);

  console.log('MONOLITH uninstall journal hardening PASS', {
    activeIntentCannotBeOverwritten:true,
    destructiveJournalTamperCannotDeleteWithoutReaffirmation:true,
    unknownStepsRejected:true,
    duplicateStepsRejected:true,
    aggregateShortcutForgeryRejected:true,
    unsupportedSchemaRejected:true
  });
})().catch(e => { console.error(e); process.exit(1); });
