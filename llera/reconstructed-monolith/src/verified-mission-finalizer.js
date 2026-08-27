'use strict';
const crypto = require('crypto');
const { DualVerifier } = require('./dual-verifier');
function canonical(value){ if(Array.isArray(value)) return value.map(canonical); if(value&&typeof value==='object') return Object.keys(value).sort().reduce((o,k)=>(o[k]=canonical(value[k]),o),{}); return value; }
function digest(value){ return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
class VerifiedMissionFinalizer {
  constructor({missionEngine,missionToolCoordinator,evidenceLedger,dualVerifier=new DualVerifier(),now=()=>Date.now()}={}){
    if(!missionEngine||typeof missionEngine.getMission!=='function'||typeof missionEngine.checkpoint!=='function') throw new Error('missionEngine getMission/checkpoint is required');
    if(!missionToolCoordinator||typeof missionToolCoordinator.canFinalize!=='function') throw new Error('missionToolCoordinator.canFinalize is required');
    if(!evidenceLedger||typeof evidenceLedger.snapshot!=='function') throw new Error('evidenceLedger.snapshot is required');
    this.missionEngine=missionEngine; this.missionToolCoordinator=missionToolCoordinator; this.evidenceLedger=evidenceLedger; this.dualVerifier=dualVerifier; this.now=now;
  }
  evaluate({missionId,claim,strictChecks=[],adversarialChecks=[]}={}){
    if(!missionId) return {ok:false,reason:'mission_id_required'};
    const mission=this.missionEngine.getMission(missionId); if(!mission) return {ok:false,reason:'mission_not_found'};
    if(mission.status!=='completed') return {ok:false,reason:'mission_not_completed',missionStatus:mission.status};
    if(!this.missionToolCoordinator.canFinalize(missionId)) return {ok:false,reason:'verification_debt_open'};
    const entries=this.evidenceLedger.snapshot().filter(e=>e&&e.missionId===missionId);
    const material=(mission.toolTrace||[]).filter(t=>t&&t.material&&['success','succeeded','completed'].includes(String(t.outcome||'').toLowerCase()));
    const missing=material.filter(t=>!Array.isArray(t.evidenceIds)||t.evidenceIds.length===0);
    if(missing.length) return {ok:false,reason:'material_action_evidence_missing',traceIds:missing.map(t=>t.id)};
    const refs=new Set(material.flatMap(t=>Array.isArray(t.evidenceIds)?t.evidenceIds:[])); const byId=new Map(entries.map(e=>[e.id,e]));
    const missingBindings=[...refs].filter(id=>!byId.has(id)); if(missingBindings.length) return {ok:false,reason:'evidence_binding_missing',evidenceIds:missingBindings};
    const evidence=[...refs].map(id=>byId.get(id)); if(!evidence.length) return {ok:false,reason:'evidence_required'};
    const verification=this.dualVerifier.verify({claim,evidence,strictChecks,adversarialChecks});
    if(!verification.ok) return {ok:false,reason:verification.reason||'dual_verifier_reject',verification};
    const payload={schema:1,missionId,claim,evidenceIds:verification.evidenceIds,strictScore:verification.strict.score,adversarialScore:verification.adversarial.score,toolTraceDigest:digest(mission.toolTrace||[]),evaluatedAt:this.now()};
    return {ok:true,reason:'verified_finalization_ready',verification,receipt:{...payload,sha256:digest(payload)}};
  }
  async finalize(input={}){ const result=this.evaluate(input); if(!result.ok) return result; const checkpoint=await this.missionEngine.checkpoint(input.missionId,{type:'verified-finalization',receipt:result.receipt,verification:{evidenceIds:result.verification.evidenceIds,strictScore:result.verification.strict.score,adversarialScore:result.verification.adversarial.score}}); return {...result,checkpoint,publishable:true}; }
}
module.exports = { VerifiedMissionFinalizer, digest };
