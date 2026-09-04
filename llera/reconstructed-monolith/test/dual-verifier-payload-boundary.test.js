'use strict';

const assert = require('assert');
const { EvidenceLedger } = require('../src/evidence-ledger');
const {
  MAX_EVIDENCE,
  MAX_CHECKS,
  MAX_EVIDENCE_REFS,
  StrictEvidenceVerifier,
  DualVerifier
} = require('../src/dual-verifier');

const ledger = new EvidenceLedger({missionId:'mission-payload-boundary'});
const evidence = ledger.add({
  stepId:'observe',
  tool:'filesystem.read',
  kind:'artifact',
  target:'C:/LLera/artifact.bin',
  bytes:Buffer.from('verified-artifact'),
  summary:'Observed verified artifact bytes.'
});

const strict = new StrictEvidenceVerifier();
const malformedEvidenceList = strict.verify({evidence:{0:evidence}, checks:[]});
assert.strictEqual(malformedEvidenceList.ok, false);
assert.strictEqual(malformedEvidenceList.reason, 'invalid_evidence_list');

const verifier = new DualVerifier();
const tooManyEvidence = verifier.verify({
  claim:'payload budget',
  evidence:Array(MAX_EVIDENCE + 1).fill(evidence),
  strictChecks:[],
  adversarialChecks:[]
});
assert.strictEqual(tooManyEvidence.ok, false);
assert.strictEqual(tooManyEvidence.reason, 'evidence_limit_exceeded');

const strictOverflow = verifier.verify({
  claim:'check budget',
  evidence:[evidence],
  strictChecks:Array.from({length:MAX_CHECKS + 1}, (_, i) => ({name:`strict-${i}`, ok:true, evidenceIds:[evidence.id]})),
  adversarialChecks:[]
});
assert.strictEqual(strictOverflow.ok, false);
assert.strictEqual(strictOverflow.reason, 'strict_check_limit_exceeded');

let coercions = 0;
const coercion = {toString(){ coercions += 1; return evidence.id; }};
const refOverflow = verifier.verify({
  claim:'ref budget',
  evidence:[evidence],
  strictChecks:[{name:'strict', ok:true, evidenceIds:Array(MAX_EVIDENCE_REFS + 1).fill(coercion)}],
  adversarialChecks:[{name:'adversarial', ok:true, evidenceIds:[evidence.id]}]
});
assert.strictEqual(refOverflow.ok, false);
assert.strictEqual(refOverflow.reason, 'strict_evidence_ref_limit_exceeded');
assert.strictEqual(coercions, 0);

const malformedMission = {...evidence, missionId:{toString(){ throw new Error('mission coercion attempted'); }}};
const missionReject = verifier.verify({
  claim:'mission text boundary',
  evidence:[malformedMission],
  strictChecks:[],
  adversarialChecks:[]
});
assert.strictEqual(missionReject.ok, false);
assert.strictEqual(missionReject.reason, 'incomplete_evidence_binding');

const malformedTool = {...evidence, tool:['filesystem.read']};
const toolReject = verifier.verify({
  claim:'tool text boundary',
  evidence:[malformedTool],
  strictChecks:[],
  adversarialChecks:[]
});
assert.strictEqual(toolReject.ok, false);
assert.strictEqual(toolReject.reason, 'invalid_evidence_tool');

const circular = {name:'strict-circular', ok:true, evidenceIds:[evidence.id]};
circular.metadata = circular;
const circularReject = verifier.verify({
  claim:'circular verifier metadata',
  evidence:[evidence],
  strictChecks:[circular],
  adversarialChecks:[{name:'adversarial-independent', ok:true, severity:'critical', evidenceIds:[evidence.id]}]
});
assert.strictEqual(circularReject.ok, false);
assert.strictEqual(circularReject.reason, 'verifier_check_metadata_invalid');

const pass = verifier.verify({
  claim:'valid payload still passes',
  evidence:[evidence],
  strictChecks:[{name:'strict-live-observation', ok:true, evidenceIds:[evidence.id]}],
  adversarialChecks:[{name:'adversarial-reobservation', ok:true, severity:'critical', evidenceIds:[evidence.id]}]
});
assert.strictEqual(pass.ok, true);
assert.strictEqual(pass.reason, 'dual_verifier_pass');

console.log('MONOLITH dual verifier payload boundary PASS', {
  malformedEvidenceListRejected:true,
  evidenceBudgetEnforced:true,
  checkBudgetEnforced:true,
  referenceBudgetEnforcedBeforeCoercion:true,
  textualBindingIdentityRequired:true,
  circularMetadataRejected:true,
  validPayloadPreserved:true
});
