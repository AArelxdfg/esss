'use strict';
const assert=require('assert'); const {VerifiedMissionFinalizer}=require('../src/verified-mission-finalizer');
(async()=>{
const ev={id:'ev_good',missionId:'m1',stepId:'s1',kind:'file',target:'artifact.bin',sha256:'a'.repeat(64)};
let mission={id:'m1',status:'completed',toolTrace:[{id:'t1',tool:'write_file',outcome:'success',material:true,verification:false,evidenceIds:['ev_good']},{id:'t2',tool:'read_file',outcome:'observed',material:false,verification:true,evidenceIds:['ev_good']}]};
let checkpoints=[],debt=false; const missionEngine={getMission:id=>id==='m1'?JSON.parse(JSON.stringify(mission)):null,checkpoint:async(id,payload)=>{const cp={id:`cp${checkpoints.length+1}`,missionId:id,payload};checkpoints.push(cp);return cp;}}; const coordinator={canFinalize:()=>!debt}; const ledger={snapshot:()=>[JSON.parse(JSON.stringify(ev))]}; const gate=new VerifiedMissionFinalizer({missionEngine,missionToolCoordinator:coordinator,evidenceLedger:ledger,now:()=>123456});
debt=true; assert.strictEqual(gate.evaluate({missionId:'m1',claim:'done',strictChecks:[{ok:true}],adversarialChecks:[{ok:true}]}).reason,'verification_debt_open');
debt=false; mission.toolTrace[0].evidenceIds=[]; assert.strictEqual(gate.evaluate({missionId:'m1',claim:'done',strictChecks:[{ok:true}],adversarialChecks:[{ok:true}]}).reason,'material_action_evidence_missing');
mission.toolTrace[0].evidenceIds=['missing']; assert.strictEqual(gate.evaluate({missionId:'m1',claim:'done',strictChecks:[{ok:true}],adversarialChecks:[{ok:true}]}).reason,'evidence_binding_missing');
mission.toolTrace[0].evidenceIds=['ev_good']; assert.strictEqual(gate.evaluate({missionId:'m1',claim:'done',strictChecks:[{ok:true}],adversarialChecks:[{ok:false}]}).reason,'dual_verifier_reject');
const final=await gate.finalize({missionId:'m1',claim:'artifact verified and mission complete',strictChecks:[{name:'hash',ok:true},{name:'mission',ok:true}],adversarialChecks:[{name:'tamper',ok:true},{name:'replay',ok:true}]});
assert.strictEqual(final.ok,true); assert.strictEqual(final.publishable,true); assert.strictEqual(final.receipt.sha256.length,64); assert.strictEqual(checkpoints[0].payload.type,'verified-finalization'); console.log('verified mission finalizer PASS',{debtGate:true,materialEvidenceGate:true,dualVerifierGate:true,receiptBound:true});
})().catch(e=>{console.error(e);process.exit(1);});
