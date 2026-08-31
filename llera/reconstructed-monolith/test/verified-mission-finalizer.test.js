'use strict';
const assert=require('assert');
const {VerifiedMissionFinalizer}=require('../src/verified-mission-finalizer');
const {EvidenceLedger}=require('../src/evidence-ledger');
(async()=>{
const evidenceLedger=new EvidenceLedger({missionId:'m1'});
const ev=evidenceLedger.add({stepId:'s1',tool:'read_file',kind:'file',target:'artifact.bin',bytes:Buffer.from('verified artifact bytes'),summary:'post-action independent read'});
let mission={id:'m1',status:'completed',toolTrace:[
 {id:'t1',stepId:'s1',tool:'write_file',outcome:'success',material:true,verification:false,argumentsHash:'material-fp-1',scope:'path:artifact.bin',evidenceIds:['ev_action_only']},
 {id:'t2',stepId:'s1',tool:'read_file',outcome:'observed',material:false,verification:true,observation:true,verifiesFingerprint:'material-fp-1',scope:'path:artifact.bin',evidenceIds:[ev.id]}
]};
let checkpoints=[],debt=false; const missionEngine={getMission:id=>id==='m1'?JSON.parse(JSON.stringify(mission)):null,checkpoint:async(id,payload)=>{const cp={id:`cp${checkpoints.length+1}`,missionId:id,payload};checkpoints.push(cp);return cp;}}; const coordinator={canFinalize:()=>!debt}; const gate=new VerifiedMissionFinalizer({missionEngine,missionToolCoordinator:coordinator,evidenceLedger,now:()=>123456});
const strictPass=[{name:'hash',ok:true,evidenceIds:[ev.id]},{name:'mission',ok:true,evidenceIds:[ev.id]}];
const adversarialPass=[{name:'tamper',ok:true,severity:'critical',evidenceIds:[ev.id]},{name:'replay',ok:true,evidenceIds:[ev.id]}];
debt=true; assert.strictEqual(gate.evaluate({missionId:'m1',claim:'done',strictChecks:strictPass,adversarialChecks:adversarialPass}).reason,'verification_debt_open');
debt=false; mission.toolTrace[1].evidenceIds=[]; assert.strictEqual(gate.evaluate({missionId:'m1',claim:'done',strictChecks:strictPass,adversarialChecks:adversarialPass}).reason,'material_action_evidence_missing');
mission.toolTrace[1].evidenceIds=['missing']; assert.strictEqual(gate.evaluate({missionId:'m1',claim:'done',strictChecks:strictPass,adversarialChecks:adversarialPass}).reason,'evidence_binding_missing');
mission.toolTrace[1].evidenceIds=[ev.id]; mission.toolTrace[1].verifiesFingerprint='wrong-fingerprint'; assert.strictEqual(gate.evaluate({missionId:'m1',claim:'done',strictChecks:strictPass,adversarialChecks:adversarialPass}).reason,'material_action_evidence_missing');
mission.toolTrace[1].verifiesFingerprint='material-fp-1'; assert.strictEqual(gate.evaluate({missionId:'m1',claim:'done',strictChecks:strictPass,adversarialChecks:[{name:'tamper',ok:false,severity:'critical',evidenceIds:[ev.id]}]}).reason,'dual_verifier_reject');
const final=await gate.finalize({missionId:'m1',claim:'artifact verified and mission complete',strictChecks:strictPass,adversarialChecks:adversarialPass});
assert.strictEqual(final.ok,true); assert.strictEqual(final.publishable,true); assert.strictEqual(final.receipt.sha256.length,64); assert.deepStrictEqual(final.receipt.evidenceIds,[ev.id]); assert.strictEqual(checkpoints[0].payload.type,'verified-finalization'); console.log('verified mission finalizer PASS',{debtGate:true,independentObservationGate:true,enrichedEvidenceGate:true,materialEvidenceGate:true,dualVerifierGate:true,receiptBound:true});
})().catch(e=>{console.error(e);process.exit(1);});
