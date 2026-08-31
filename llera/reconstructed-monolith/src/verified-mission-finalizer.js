'use strict';
const crypto = require('crypto');
const { DualVerifier } = require('./dual-verifier');
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.keys(value).sort().reduce((o,k)=>(o[k]=canonical(value[k]),o),{});return value;}
function digest(value){return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');}
function successful(trace){return ['success','succeeded','completed','observed','verified'].includes(String(trace&&trace.outcome||'').toLowerCase());}
function traceFingerprint(trace){return trace&&(trace.argumentsHash||trace.fingerprint||null)||null;}
function explicitVerificationFingerprint(trace){return trace&&(trace.verifiesFingerprint||trace.verifies||trace.verificationOf||trace.materialFingerprint||null)||null;}
function verificationTraceForMaterial(toolTrace,materialIndex){
 const material=toolTrace[materialIndex];
 if(!material||!material.material||!successful(material))return null;
 const materialFingerprint=traceFingerprint(material);
 for(let i=materialIndex+1;i<toolTrace.length;i+=1){
  const trace=toolTrace[i];
  if(trace&&trace.material&&successful(trace))break;
  if(!trace||trace.material||!successful(trace)||!(trace.verification||trace.observation))continue;
  if(material.stepId&&trace.stepId&&material.stepId!==trace.stepId)continue;
  const explicit=explicitVerificationFingerprint(trace);
  if(explicit){if(materialFingerprint&&explicit===materialFingerprint)return trace;continue;}
  if(material.scope&&trace.scope&&material.scope===trace.scope)return trace;
 }
 return null;
}
function evidenceIdsForMaterial(toolTrace,materialIndex){const verification=verificationTraceForMaterial(toolTrace,materialIndex);if(!verification)return[];return [...new Set((Array.isArray(verification.evidenceIds)?verification.evidenceIds:[]).filter(Boolean))];}
function normalizeMaterialBindings(bindings=[]){return bindings.map(b=>({traceId:b.traceId||null,evidenceIds:[...new Set(b.evidenceIds||[])].sort()}));}
function receiptStateKey({missionId,claim,evidenceIds,materialBindings,strictScore,adversarialScore,toolTraceDigest}={}){return digest({schema:2,missionId,claim:claim||'',evidenceIds:[...new Set(evidenceIds||[])].sort(),materialBindings:normalizeMaterialBindings(materialBindings),strictScore:Number(strictScore||0),adversarialScore:Number(adversarialScore||0),toolTraceDigest});}
function findReplayCheckpoint(mission,stateKey){const cps=Array.isArray(mission&&mission.checkpoints)?mission.checkpoints:[];return [...cps].reverse().find(cp=>cp&&cp.payload&&cp.payload.type==='verified-finalization'&&cp.payload.receipt&&cp.payload.receipt.stateKey===stateKey&&cp.payload.receipt.sha256===stateKey)||null;}
class VerifiedMissionFinalizer{
 constructor({missionEngine,missionToolCoordinator,evidenceLedger,dualVerifier=new DualVerifier(),now=()=>Date.now()}={}){if(!missionEngine||typeof missionEngine.getMission!=='function'||typeof missionEngine.checkpoint!=='function')throw new Error('missionEngine getMission/checkpoint is required');if(!missionToolCoordinator||typeof missionToolCoordinator.canFinalize!=='function')throw new Error('missionToolCoordinator.canFinalize is required');if(!evidenceLedger||typeof evidenceLedger.snapshot!=='function')throw new Error('evidenceLedger.snapshot is required');this.missionEngine=missionEngine;this.missionToolCoordinator=missionToolCoordinator;this.evidenceLedger=evidenceLedger;this.dualVerifier=dualVerifier;this.now=now;}
 evaluate({missionId,claim,strictChecks=[],adversarialChecks=[]}={}){if(!missionId)return {ok:false,reason:'mission_id_required'};const mission=this.missionEngine.getMission(missionId);if(!mission)return {ok:false,reason:'mission_not_found'};if(mission.status!=='completed')return {ok:false,reason:'mission_not_completed',missionStatus:mission.status};if(!this.missionToolCoordinator.canFinalize(missionId))return {ok:false,reason:'verification_debt_open'};const entries=this.evidenceLedger.snapshot().filter(e=>e&&e.missionId===missionId);const trace=mission.toolTrace||[];const materialIndexes=trace.map((t,index)=>({t,index})).filter(({t})=>t&&t.material&&successful(t)).map(({index})=>index);const materialBindings=normalizeMaterialBindings(materialIndexes.map(index=>({traceId:trace[index].id,evidenceIds:evidenceIdsForMaterial(trace,index)})));const missing=materialBindings.filter(b=>b.evidenceIds.length===0);if(missing.length)return {ok:false,reason:'material_action_evidence_missing',traceIds:missing.map(x=>x.traceId)};const refs=new Set(materialBindings.flatMap(b=>b.evidenceIds));const byId=new Map(entries.map(e=>[e.id,e]));const missingBindings=[...refs].filter(id=>!byId.has(id));if(missingBindings.length)return {ok:false,reason:'evidence_binding_missing',evidenceIds:missingBindings};const evidence=[...refs].sort().map(id=>byId.get(id));if(!evidence.length)return {ok:false,reason:'evidence_required'};const verification=this.dualVerifier.verify({claim,evidence,strictChecks,adversarialChecks});if(!verification.ok)return {ok:false,reason:verification.reason||'dual_verifier_reject',verification};const identity={missionId,claim:claim||'',evidenceIds:[...new Set(verification.evidenceIds||[])].sort(),materialBindings,strictScore:Number(verification.strict.score),adversarialScore:Number(verification.adversarial.score),toolTraceDigest:digest(trace)};const stateKey=receiptStateKey(identity);return {ok:true,reason:'verified_finalization_ready',verification,materialBindings,stateKey,receipt:{schema:2,...identity,stateKey,sha256:stateKey,issuedAt:this.now()}};}
 async finalize(input={}){const result=this.evaluate(input);if(!result.ok)return result;const mission=this.missionEngine.getMission(input.missionId);const replay=findReplayCheckpoint(mission,result.stateKey);if(replay)return {...result,receipt:{...replay.payload.receipt},checkpoint:replay,publishable:true,replayed:true};const checkpoint=await this.missionEngine.checkpoint(input.missionId,{type:'verified-finalization',receipt:result.receipt,verification:{evidenceIds:result.verification.evidenceIds,materialBindings:result.materialBindings,strictScore:result.verification.strict.score,adversarialScore:result.verification.adversarial.score}});return {...result,checkpoint,publishable:true,replayed:false};}
}
module.exports={VerifiedMissionFinalizer,digest,traceFingerprint,explicitVerificationFingerprint,verificationTraceForMaterial,evidenceIdsForMaterial,normalizeMaterialBindings,receiptStateKey,findReplayCheckpoint};
