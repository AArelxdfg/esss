'use strict';

const assert = require('assert');
const { OutcomeMemory } = require('../src/outcome-memory');
const { digest, receiptStateKey } = require('../src/verified-mission-finalizer');

const EV_A = `ev_${'a'.repeat(24)}`;
const EV_B = `ev_${'b'.repeat(24)}`;
const EV_FOREIGN = `ev_${'f'.repeat(24)}`;

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
      evidenceIds:[EV_A,EV_B,EV_A],
      receipt:receiptFor({missionId:'m-good',claim:'download verified',evidenceIds:[EV_A,EV_B]})
    }
  });
  assert.strictEqual(source.verified, true);
  assert.deepStrictEqual(source.verification.evidenceIds, [EV_A,EV_B]);

  const candidate = await memory.proposeSkill({
    missionId:'m-good',
    name:'Verified resumable download',
    description:'Only activate after integrity verification.',
    procedure:['validate metadata','resume','verify sha256','activate'],
    evidenceIds:[EV_B,EV_B],
    verification:{
      strict:true,
      adversarial:true,
      confidence:0.90,
      evidenceIds:[EV_B],
      receiptSha256:source.verification.receiptSha256
    }
  });
  assert.deepStrictEqual(candidate.evidenceIds, [EV_B]);
  assert.deepStrictEqual(candidate.sourceEvidenceIds, [EV_A,EV_B]);
  assert.strictEqual(candidate.executable, false);
  assert.strictEqual(candidate.trust, 'candidate-only');

  await assert.rejects(
    () => memory.proposeSkill({
      missionId:'m-good',
      name:'Injected provenance skill',
      description:'must reject evidence from another mission',
      procedure:['x'],
      evidenceIds:[EV_FOREIGN],
      verification:{strict:true, adversarial:true, confidence:0.95, evidenceIds:[EV_FOREIGN], receiptSha256:source.verification.receiptSha256}
    }),
    /not derived from source outcome/
  );

  await assert.rejects(
    () => memory.proposeSkill({
      missionId:'m-good',
      name:'Malformed provenance skill',
      description:'must reject noncanonical evidence ids',
      procedure:['x'],
      evidenceIds:['ev_source_a'],
      verification:{strict:true, adversarial:true, confidence:0.95, evidenceIds:['ev_source_a'], receiptSha256:source.verification.receiptSha256}
    }),
    error => error && error.code === 'OUTCOME_EVIDENCE_ID_INVALID'
  );

  await assert.rejects(
    () => memory.proposeSkill({
      missionId:'m-good',
      name:'Verifier coverage gap',
      description:'candidate evidence must be covered by verification',
      procedure:['x'],
      evidenceIds:[EV_A,EV_B],
      verification:{strict:true, adversarial:true, confidence:0.95, evidenceIds:[EV_A], receiptSha256:source.verification.receiptSha256}
    }),
    /not covered by skill verification/
  );

  console.log('MONOLITH skill evidence provenance PASS', {
    evidenceRequiredForVerifiedOutcome:true,
    canonicalEvidenceIdsRequired:true,
    sourceOutcomeBinding:true,
    foreignEvidenceRejected:true,
    verifierCoverageEnforced:true,
    candidateTrustBoundaryPreserved:true
  });
})().catch(err => { console.error(err); process.exit(1); });
