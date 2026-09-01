'use strict';

const assert = require('assert');
const { OutcomeMemory } = require('../src/outcome-memory');
const { digest, receiptStateKey } = require('../src/verified-mission-finalizer');

function receiptFor({missionId, claim, evidenceIds}) {
  const strictScore = 0.91;
  const adversarialScore = 0.88;
  const toolTraceDigest = digest([]);
  const stateKey = receiptStateKey({missionId,claim,evidenceIds,materialBindings:[],strictScore,adversarialScore,toolTraceDigest});
  return {schema:2,missionId,claim,evidenceIds,materialBindings:[],strictScore,adversarialScore,toolTraceDigest,stateKey,sha256:stateKey,issuedAt:1};
}

(async () => {
  let persisted = null;
  let clock = 2000;
  const load = async () => persisted;
  const save = async state => { persisted = JSON.parse(JSON.stringify(state)); };
  const memory = new OutcomeMemory({ load, save, now: () => ++clock });
  await memory.init();

  const noEvidence = await memory.recordOutcome({
    missionId:'m-no-evidence',
    goal:'do something',
    status:'completed',
    verification:{}
  });
  assert.strictEqual(noEvidence.verified, false, 'an outcome without persisted evidence must not become verified');

  const source = await memory.recordOutcome({
    missionId:'m-good',
    goal:'download model safely',
    status:'completed',
    summary:'validated ranges and sha256',
    verification:{
      strict:true,
      adversarial:true,
      confidence:0.91,
      evidenceIds:['ev_source_a','ev_source_b','ev_source_a'],
      receipt:receiptFor({missionId:'m-good',claim:'download verified',evidenceIds:['ev_source_a','ev_source_b']})
    }
  });
  assert.strictEqual(source.verified, true);
  assert.deepStrictEqual(source.verification.evidenceIds, ['ev_source_a','ev_source_b']);

  const candidate = await memory.proposeSkill({
    missionId:'m-good',
    name:'Verified resumable download',
    description:'Only activate after integrity verification.',
    procedure:['validate metadata','resume','verify sha256','activate'],
    evidenceIds:['ev_source_b','ev_source_b'],
    verification:{
      strict:true,
      adversarial:true,
      confidence:0.90,
      evidenceIds:['ev_source_b'],
      receiptSha256:source.verification.receiptSha256
    }
  });
  assert.deepStrictEqual(candidate.evidenceIds, ['ev_source_b']);
  assert.deepStrictEqual(candidate.sourceEvidenceIds, ['ev_source_a','ev_source_b']);
  assert.strictEqual(candidate.executable, false);
  assert.strictEqual(candidate.trust, 'candidate-only');

  await assert.rejects(
    () => memory.proposeSkill({
      missionId:'m-good',
      name:'Injected provenance skill',
      description:'must reject evidence from another mission',
      procedure:['x'],
      evidenceIds:['ev_foreign'],
      verification:{strict:true, adversarial:true, confidence:0.95, evidenceIds:['ev_foreign'], receiptSha256:source.verification.receiptSha256}
    }),
    /not derived from source outcome/
  );

  await assert.rejects(
    () => memory.proposeSkill({
      missionId:'m-good',
      name:'Verifier coverage gap',
      description:'candidate evidence must be covered by verification',
      procedure:['x'],
      evidenceIds:['ev_source_a','ev_source_b'],
      verification:{strict:true, adversarial:true, confidence:0.95, evidenceIds:['ev_source_a'], receiptSha256:source.verification.receiptSha256}
    }),
    /not covered by skill verification/
  );

  console.log('MONOLITH skill evidence provenance PASS', {
    evidenceRequiredForVerifiedOutcome:true,
    sourceOutcomeBinding:true,
    foreignEvidenceRejected:true,
    verifierCoverageEnforced:true,
    candidateTrustBoundaryPreserved:true
  });
})().catch(err => { console.error(err); process.exit(1); });
