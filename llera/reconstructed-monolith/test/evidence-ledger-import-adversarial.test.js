'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EvidenceLedger } = require('../src/evidence-ledger');

const observedAt = '2026-08-31T10:00:00.000Z';
const source = new EvidenceLedger({missionId:'mission-evidence'});
const input = {
  stepId:'observe-state',
  tool:'read_file',
  kind:'state',
  target:'C:/LLera/state.json',
  bytes:Buffer.from('state-A'),
  summary:'Observed the state after the material action',
  observedAt
};
const entry = source.add(input);

assert.strictEqual(entry.byteCount, 7);
assert.strictEqual(entry.tool, 'read_file');
assert.strictEqual(entry.summary, input.summary);
assert.strictEqual(entry.observedAt, observedAt);
assert.strictEqual(source.verifyBinding(entry.id,{target:entry.target,tool:entry.tool,bytes:input.bytes}).ok,true);
assert.strictEqual(source.verifyBinding(entry.id,{tool:entry.tool,bytes:input.bytes}).reason,'target_missing');
assert.strictEqual(source.verifyBinding(entry.id,{target:entry.target,bytes:input.bytes}).reason,'tool_missing');
assert.strictEqual(source.verifyBinding(entry.id,{target:entry.target,tool:entry.tool,digest:entry.sha256}).reason,'digest_only_rejected');
assert.strictEqual(source.verifyBinding(entry.id,{target:'C:/LLera/forged.json',tool:entry.tool,bytes:input.bytes}).reason,'target_mismatch');
assert.strictEqual(source.verifyBinding(entry.id,{target:entry.target,tool:'system_info',bytes:input.bytes}).reason,'tool_mismatch');
assert.strictEqual(source.verifyBinding(entry.id,{target:entry.target,tool:entry.tool,bytes:Buffer.from('state-B')}).reason,'sha256_mismatch');
assert.throws(() => source.add(input), error => error && error.code === 'EVIDENCE_LEDGER_DUPLICATE');

const exported = source.export();
const restored = new EvidenceLedger({missionId:'mission-evidence'});
assert.deepStrictEqual(restored.import(exported), exported);
assert.notStrictEqual(restored.export(), exported);

const forgedTarget = exported.map(item => ({...item,target:'C:/LLera/forged.json'}));
assert.throws(() => restored.import(forgedTarget), error => error && error.code === 'EVIDENCE_LEDGER_ENTRY_TAMPERED');
const forgedDigest = exported.map(item => ({...item,sha256:'f'.repeat(64)}));
assert.throws(() => restored.import(forgedDigest), error => error && error.code === 'EVIDENCE_LEDGER_ENTRY_TAMPERED');
const forgedTool = exported.map(item => ({...item,tool:'system_info'}));
assert.throws(() => restored.import(forgedTool), error => error && error.code === 'EVIDENCE_LEDGER_ENTRY_TAMPERED');
assert.throws(() => restored.import([...exported,...exported]), error => error && error.code === 'EVIDENCE_LEDGER_IMPORT_DUPLICATE');

const foreignMission = new EvidenceLedger({missionId:'mission-foreign'});
assert.throws(() => foreignMission.import(exported), error => error && error.code === 'EVIDENCE_LEDGER_ENTRY_INVALID');

const beforeInvalidImport = restored.snapshot();
assert.throws(() => restored.import([...exported,...forgedDigest]), error => error && error.code === 'EVIDENCE_LEDGER_ENTRY_TAMPERED');
assert.deepStrictEqual(restored.snapshot(), beforeInvalidImport);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llera-evidence-import-'));
try {
  const blockedPath = path.join(dir, 'blocked-store');
  fs.mkdirSync(blockedPath);
  const persistenceProbe = new EvidenceLedger({missionId:'mission-evidence'});
  persistenceProbe.import(exported);
  const beforePersistenceFailure = persistenceProbe.snapshot();
  persistenceProbe.storagePath = blockedPath;
  assert.throws(() => persistenceProbe.import([]), error => error && error.code === 'EVIDENCE_LEDGER_PERSIST_FAILED');
  assert.deepStrictEqual(persistenceProbe.snapshot(), beforePersistenceFailure);
} finally {
  fs.rmSync(dir,{recursive:true,force:true});
}

console.log('MONOLITH evidence import and binding adversarial PASS', {
  requiredTargetAndTool:true,
  digestOnlyRejected:true,
  byteCountBound:true,
  importedIdRecomputed:true,
  crossMissionReplayRejected:true,
  duplicateIdsRejected:true,
  importAtomicOnValidationAndPersistenceFailure:true
});
