'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EvidenceLedger, ledgerSeal } = require('../src/evidence-ledger');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llera-evidence-'));
const store = path.join(dir, 'evidence-ledger.json');
try {
  const first = new EvidenceLedger({missionId:'mission-persist', storagePath:store});
  const entry = first.add({stepId:'s1',tool:'read_file',kind:'artifact',target:'C:/LLera/app.exe',bytes:Buffer.from('artifact-v1'),summary:'Observed persisted executable bytes'});
  assert.strictEqual(fs.existsSync(store), true);

  const restarted = new EvidenceLedger({missionId:'mission-persist', storagePath:store});
  assert.strictEqual(restarted.snapshot().length, 1);
  assert.strictEqual(restarted.snapshot()[0].id, entry.id);
  assert.strictEqual(restarted.verifyBinding(entry.id,{target:'C:/LLera/app.exe',tool:'read_file',bytes:Buffer.from('artifact-v1')}).ok,true);

  const parsed = JSON.parse(fs.readFileSync(store,'utf8'));
  parsed.entries[0].target = 'C:/LLera/evil.exe';
  parsed.stateSha256 = ledgerSeal(parsed);
  fs.writeFileSync(store, JSON.stringify(parsed));
  assert.throws(
    () => new EvidenceLedger({missionId:'mission-persist', storagePath:store}),
    error => error && error.code === 'EVIDENCE_LEDGER_ENTRY_TAMPERED'
  );

  fs.writeFileSync(store, '{not-json');
  assert.throws(
    () => new EvidenceLedger({missionId:'mission-persist', storagePath:store}),
    error => error && error.code === 'EVIDENCE_LEDGER_STORE_CORRUPT'
  );

  const wrongMissionStore = path.join(dir,'wrong-mission.json');
  const source = new EvidenceLedger({missionId:'mission-a',storagePath:wrongMissionStore});
  source.add({stepId:'s',tool:'read_file',kind:'state',target:'x',bytes:Buffer.from('x'),summary:'Observed mission-bound state'});
  assert.throws(
    () => new EvidenceLedger({missionId:'mission-b',storagePath:wrongMissionStore}),
    error => error && error.code === 'EVIDENCE_LEDGER_STORE_INVALID'
  );

  console.log('MONOLITH durable evidence ledger PASS', {
    restartRestoresEvidence:true,
    stateSealChecked:true,
    entryBindingChecked:true,
    corruptJsonFailsClosed:true,
    missionBindingFailsClosed:true
  });
} finally {
  fs.rmSync(dir,{recursive:true,force:true});
}
