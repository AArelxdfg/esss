'use strict';
const assert = require('assert');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { WindowsUninstallTransaction } = require('../src/windows-uninstall-transaction');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'llera-uninstall-tx-'));
  for (const d of ['app','staging','rollback','repair-quarantine','data','models']) {
    await fs.mkdir(path.join(root,d), {recursive:true});
    await fs.writeFile(path.join(root,d,'sentinel.txt'), d);
  }

  const shortcuts=[]; let unregister=0; let stop=0; let failOnce=true;
  const tx = new WindowsUninstallTransaction({
    rootDir: root,
    stopApp: async()=>{stop++;},
    removeShortcut: async scope=>{ shortcuts.push(scope); if(scope==='startup' && failOnce){ failOnce=false; throw new Error('simulated shortcut removal failure'); } },
    unregisterApp: async()=>{unregister++;}
  });

  let interrupted=false;
  try { await tx.begin({keepData:true, keepModels:false}); } catch (e) { interrupted=/simulated/.test(e.message); }
  assert.strictEqual(interrupted,true);
  assert.strictEqual(await fs.readFile(path.join(root,'data','sentinel.txt'),'utf8'),'data');

  await assert.rejects(
    () => tx.resume(),
    /explicit model deletion confirmation/,
    'crash resume must not trust destructive journal retention flags by themselves'
  );
  assert.strictEqual(await fs.stat(path.join(root,'models')).then(()=>true,()=>false),true);

  const resumed = await tx.resume({confirmModelDeletion:true});
  assert.strictEqual(resumed.uninstalled,true);
  assert.strictEqual(resumed.keepData,true);
  assert.strictEqual(resumed.keepModels,false);
  assert.strictEqual(await fs.stat(path.join(root,'data')).then(()=>true,()=>false),true);
  assert.strictEqual(await fs.stat(path.join(root,'models')).then(()=>true,()=>false),false);
  assert.strictEqual(unregister,1);
  assert.strictEqual(stop,1, 'completed stop-app step must not repeat after restart');
  assert.deepStrictEqual(shortcuts, ['desktop','start-menu','startup','startup','taskbar'],
    'completed shortcut scopes must not replay after restart');

  const journal = JSON.parse(await fs.readFile(path.join(root,'uninstall-journal.json'),'utf8'));
  assert.strictEqual(journal.schema,3);
  assert.strictEqual(journal.state,'uninstalled');
  assert(journal.completed.includes('remove-shortcuts'));
  assert(journal.completed.includes('remove-models'));
  assert(!journal.completed.includes('remove-data'));

  await fs.writeFile(path.join(root,'uninstall-journal.json'), '{bad json');
  const corrupt = new WindowsUninstallTransaction({rootDir:root});
  await assert.rejects(() => corrupt.resume(), /corrupt; refusing destructive recovery/);

  console.log('MONOLITH resumable uninstall transaction PASS', {
    interruptedResume:true,
    destructiveResumeReaffirmation:true,
    perScopeShortcutCheckpointing:true,
    idempotentCompletedSteps:true,
    independentDataModelRetention:true,
    staleIntegrationCleanup:true,
    corruptJournalFailsClosed:true
  });
})().catch(e=>{ console.error(e); process.exit(1); });
