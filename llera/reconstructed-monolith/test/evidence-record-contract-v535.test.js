'use strict';

const assert = require('assert');
const {
  EvidenceLedger,
  SUMMARY_MAX_CHARS,
  evidenceBindingSeal,
  ledgerSeal
} = require('../src/evidence-ledger');

const bytes = Buffer.from('installer-bytes-v535');
const ledger = new EvidenceLedger({missionId:'mission-v535-contract'});
const entry = ledger.add({
  stepId:'build-installer',
  tool:'windows_installer_build',
  kind:'artifact',
  target:'C:/LLera/LLera_Setup_v5.3.5.exe',
  bytes,
  summary:'Signed installer build output '.repeat(80),
  metadata:{channel:'candidate'}
});

assert.equal(entry.tool, 'windows_installer_build');
assert.equal(entry.byteCount, bytes.length);
assert.ok(entry.summary.length <= SUMMARY_MAX_CHARS);
assert.match(entry.sha256, /^[a-f0-9]{64}$/);
assert.match(entry.bindingSha256, /^[a-f0-9]{64}$/);
assert.equal(entry.bindingSha256, evidenceBindingSeal(entry));
assert.deepEqual(ledger.verifyBinding(entry.id, {target:entry.target, bytes}), {ok:true, entry});

const sealed = ledger.export({sealed:true});
assert.equal(sealed.entries[0].tool, entry.tool);
assert.equal(sealed.entries[0].byteCount, bytes.length);
assert.equal(sealed.stateSha256, ledgerSeal(sealed));

// A forged tool identity is rejected even when the attacker recomputes the
// outer ledger seal; the per-record tool/target/hash/byte binding must match.
const forgedTool = JSON.parse(JSON.stringify(sealed));
forgedTool.entries[0].tool = 'powershell_exec';
forgedTool.stateSha256 = ledgerSeal(forgedTool);
assert.throws(
  () => new EvidenceLedger({missionId:'mission-v535-contract'}).import(forgedTool),
  error => error && error.code === 'EVIDENCE_LEDGER_ENTRY_TAMPERED'
);

// Same for byte-count tampering: a valid outer state seal cannot hide a
// modified material binding.
const forgedBytes = JSON.parse(JSON.stringify(sealed));
forgedBytes.entries[0].byteCount += 1;
forgedBytes.stateSha256 = ledgerSeal(forgedBytes);
assert.throws(
  () => new EvidenceLedger({missionId:'mission-v535-contract'}).import(forgedBytes),
  error => error && error.code === 'EVIDENCE_LEDGER_ENTRY_TAMPERED'
);

console.log('MONOLITH V5.3.5 evidence record contract gate PASS');
