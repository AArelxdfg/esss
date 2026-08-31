'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EvidenceLedger } = require('../src/evidence-ledger');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llera-evidence-import-'));
try {
  const source = new EvidenceLedger({missionId:'mission-export'});
  const first = source.add({stepId:'s1',kind:'artifact',target:'C:/LLera/app.exe',bytes:Buffer.from('artifact-v1'),metadata:{summary:'built'}});
  source.add({stepId:'s2',kind:'observation',target:'C:/LLera/app.exe',bytes:Buffer.from('artifact-v1'),metadata:{summary:'read-back'}});

  const plain = source.export();
  assert.ok(Array.isArray(plain));
  assert.strictEqual(plain.length, 2);

  const sealed = source.export({sealed:true});
  assert.strictEqual(sealed.schema, 2);
  assert.strictEqual(sealed.missionId, 'mission-export');
  assert.match(sealed.stateSha256, /^[a-f0-9]{64}$/);

  const store = path.join(dir, 'ledger.json');
  const restored = new EvidenceLedger({missionId:'mission-export',storagePath:store});
  const imported = restored.import(sealed);
  assert.strictEqual(imported.length, 2);
  assert.strictEqual(restored.verifyBinding(first.id,{target:'C:/LLera/app.exe',bytes:Buffer.from('artifact-v1')}).ok,true);
  assert.strictEqual(fs.existsSync(store), true);

  const beforeTamper = restored.snapshot();
  const tampered = JSON.parse(JSON.stringify(sealed));
  tampered.entries[0].target = 'C:/LLera/evil.exe';
  assert.throws(
    () => restored.import(tampered),
    error => error && error.code === 'EVIDENCE_LEDGER_STORE_TAMPERED'
  );
  assert.deepStrictEqual(restored.snapshot(), beforeTamper, 'failed import must not mutate live ledger');

  const wrongMission = JSON.parse(JSON.stringify(sealed));
  wrongMission.missionId = 'other-mission';
  assert.throws(
    () => restored.import(wrongMission),
    error => error && error.code === 'EVIDENCE_LEDGER_STORE_INVALID'
  );
  assert.deepStrictEqual(restored.snapshot(), beforeTamper);

  console.log('MONOLITH evidence sealed export/import PASS', {
    plainExportCompatibility:true,
    sealedState:true,
    atomicImport:true,
    tamperFailsClosed:true,
    missionBindingFailsClosed:true
  });
} finally {
  fs.rmSync(dir,{recursive:true,force:true});
}
