'use strict';

const assert = require('assert');
const { EvidenceLedger } = require('../src/evidence-ledger');
const { DualVerifier } = require('../src/dual-verifier');

function verifyOne(verifier, evidence, claim = 'artifact is bound') {
  return verifier.verify({
    claim,
    evidence,
    strictChecks:[{name:'strict-live-observation',ok:true,evidenceIds:evidence.map(e => e.id)}],
    adversarialChecks:[{name:'adversarial-reobservation',ok:true,severity:'critical',evidenceIds:evidence.map(e => e.id)}]
  });
}

const ledger = new EvidenceLedger({missionId:'mission-enriched'});
const ev = ledger.add({
  stepId:'observe-output',
  tool:'filesystem.read',
  kind:'artifact',
  target:'C:/LLera/output.bin',
  bytes:Buffer.from('verified-output'),
  summary:'Observed final output bytes after material action.'
});

const verifier = new DualVerifier();
const pass = verifyOne(verifier, [ev]);
assert.strictEqual(pass.ok, true);
assert.strictEqual(pass.missionId, 'mission-enriched');

const tamperedTool = {...ev, tool:'filesystem.write'};
const toolReject = verifyOne(verifier, [tamperedTool]);
assert.strictEqual(toolReject.ok, false);
assert.strictEqual(toolReject.reason, 'evidence_binding_seal_mismatch');

const tamperedBytes = {...ev, byteCount:ev.byteCount + 1};
const byteReject = verifyOne(verifier, [tamperedBytes]);
assert.strictEqual(byteReject.ok, false);
assert.strictEqual(byteReject.reason, 'evidence_binding_seal_mismatch');

const tamperedSeal = {...ev, bindingSha256:'0'.repeat(64)};
const sealReject = verifyOne(verifier, [tamperedSeal]);
assert.strictEqual(sealReject.ok, false);
assert.strictEqual(sealReject.reason, 'evidence_binding_seal_mismatch');

const missingTool = {...ev};
delete missingTool.tool;
const missingToolReject = verifyOne(verifier, [missingTool]);
assert.strictEqual(missingToolReject.ok, false);
assert.strictEqual(missingToolReject.reason, 'invalid_evidence_tool');

const oversizedSummary = {...ev, summary:'x'.repeat(513)};
const summaryReject = verifyOne(verifier, [oversizedSummary]);
assert.strictEqual(summaryReject.ok, false);
assert.strictEqual(summaryReject.reason, 'evidence_summary_too_long');

const otherLedger = new EvidenceLedger({missionId:'mission-other'});
const other = otherLedger.add({
  stepId:'observe-other',
  tool:'filesystem.read',
  kind:'artifact',
  target:'C:/LLera/other.bin',
  bytes:Buffer.from('other-output')
});
const mixedMission = verifyOne(verifier, [ev, other], 'mixed mission claim');
assert.strictEqual(mixedMission.ok, false);
assert.strictEqual(mixedMission.reason, 'mixed_mission_evidence_reject');

console.log('MONOLITH dual verifier enriched evidence binding PASS', {
  enrichedPass:true,
  toolTamperRejected:true,
  byteCountTamperRejected:true,
  sealTamperRejected:true,
  missingToolRejected:true,
  oversizedSummaryRejected:true,
  mixedMissionRejected:true
});
