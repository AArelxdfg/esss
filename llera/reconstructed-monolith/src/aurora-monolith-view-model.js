'use strict';

const { missionHasVerificationDebt } = require('./mission-verification-debt');

class AuroraMonolithViewModel {
  constructor({ ui, runtime, missionEngine, evidenceLedger, hostguard, activitySource = null } = {}) {
    if (!ui || typeof ui.getNavigationState !== 'function' || typeof ui.getResponsiveLayout !== 'function') throw new Error('Aurora UI contract is required');
    if (!runtime || typeof runtime.snapshot !== 'function') throw new Error('runtime.snapshot is required');
    if (!missionEngine || typeof missionEngine.listMissions !== 'function') throw new Error('missionEngine.listMissions is required');
    if (!evidenceLedger || typeof evidenceLedger.export !== 'function') throw new Error('evidenceLedger.export is required');
    if (!hostguard || (typeof hostguard.status !== 'function' && typeof hostguard.policy !== 'function')) throw new Error('hostguard status/policy is required');
    if (activitySource != null && typeof activitySource !== 'function') throw new Error('activitySource must be a function when provided');
    this.ui = ui; this.runtime = runtime; this.missionEngine = missionEngine; this.evidenceLedger = evidenceLedger; this.hostguard = hostguard; this.activitySource = activitySource; this.lastSnapshot = null;
  }

  async snapshot() {
    const runtime = normalizeRuntime(await this.runtime.snapshot());
    const missions = normalizeMissions(await this.missionEngine.listMissions());
    const evidence = normalizeEvidence(await this.evidenceLedger.export());
    const pressure = normalizePressure(await readHostguard(this.hostguard));
    const activity = normalizeActivity(this.activitySource ? await this.activitySource() : []);
    const activeMission = missions.find(m => m.status === 'running') || missions.find(m => m.status === 'interrupted') || missions.find(m => m.status === 'pending') || null;
    const model = {
      schema: 5401,
      product: 'LLera MONOLITH OMEGA reconstructed',
      exactHistoricalV54: false,
      navigation: this.ui.getNavigationState(),
      layout: this.ui.getResponsiveLayout(),
      motion: this.ui.getMotionPolicy ? this.ui.getMotionPolicy() : null,
      accessibility: this.ui.getAccessibilityContract ? this.ui.getAccessibilityContract() : null,
      surfaces: {
        conversation: { runtimeReady: runtime.state === 'ready', model: runtime.model, generation: runtime.generation, composer: this.ui.getComposerState ? this.ui.getComposerState() : null },
        work: { total: missions.length, activeMission, running: missions.filter(m => m.status === 'running').length, interrupted: missions.filter(m => m.status === 'interrupted').length, completed: missions.filter(m => m.status === 'completed').length, verificationBlocked: missions.filter(m => m.verificationDebtOpen).length },
        activity: { total: activity.length, recent: activity.slice(-50).reverse() },
        evidence: { total: evidence.length, records: evidence.slice(-200).reverse(), bound: evidence.filter(e => e.id && e.target && e.sha256).length },
        systemModels: { runtime, pressure }
      },
      health: deriveHealth({ runtime, missions, evidence, pressure })
    };
    this.lastSnapshot = deepClone(model);
    return deepClone(model);
  }

  async activateSurface(surface) { this.ui.setSurface(surface); return this.snapshot(); }
  async handleShortcut(event) { const result = this.ui.handleShortcut(event); const model = await this.snapshot(); return { result, model }; }
  async handleNavigationKey(event) {
    if (typeof this.ui.handleNavigationKey !== 'function') return { result: { handled: false }, model: await this.snapshot() };
    const result = this.ui.handleNavigationKey(event);
    const model = await this.snapshot();
    return { result, model };
  }
  statusStrip(model = this.lastSnapshot) {
    if (!model) return null;
    const r = model.surfaces.systemModels.runtime, p = model.surfaces.systemModels.pressure, w = model.surfaces.work;
    return { runtime:r.state, model:r.model, pressure:p.level, mission:w.activeMission ? w.activeMission.id : null, interrupted:w.interrupted, evidence:model.surfaces.evidence.total, health:model.health.level };
  }
}

async function readHostguard(hostguard) { if (typeof hostguard.status === 'function') return hostguard.status(); return hostguard.policy(); }
function normalizeRuntime(value) { const x=value||{}; return { state:String(x.state||x.status||'unknown').toLowerCase(), model:x.model||x.desiredModel||x.activeModel||null, desiredModel:x.desiredModel||x.model||null, generation:Number.isFinite(x.generation)?x.generation:0, endpoint:x.endpoint||x.bind||'127.0.0.1:18191', activeTasks:Array.isArray(x.activeTasks)?x.activeTasks.length:Number(x.activeTaskCount||0) }; }
function normalizeMissions(value) { return (Array.isArray(value)?value:[]).map(m=>({ id:m.id, title:m.title||m.goal||m.id, status:String(m.status||'unknown').toLowerCase(), currentStepId:m.currentStepId||null, checkpointCount:Array.isArray(m.checkpoints)?m.checkpoints.length:Number(m.checkpointCount||0), toolTraceCount:Array.isArray(m.toolTrace)?m.toolTrace.length:Number(m.toolTraceCount||0), verificationDebtOpen:missionHasVerificationDebt(m) })); }
function normalizeEvidence(value) { return (Array.isArray(value)?value:[]).map(e=>({ id:e.id||e.evidenceId||null, target:e.target||e.targetScope||null, sha256:e.sha256||e.resultSha256||null, kind:e.kind||null, tool:e.tool||null, bytes:Number(e.bytes||e.byteCount||0) })); }
function normalizePressure(value) { const x=value||{}, policy=x.policy||x; return { level:String(x.pressure||x.state||policy.pressure||'normal').toLowerCase(), score:Number(x.score||0), downloadWorkers:Number(policy.downloadWorkers||8), allowVisionLoad:policy.allowVisionLoad!==false, runtimePriority:policy.runtimePriority||null }; }
function normalizeActivity(value) { return (Array.isArray(value)?value:[]).map((a,i)=>({ id:a.id||`activity-${i}`, type:a.type||a.kind||'event', summary:a.summary||a.message||'', at:a.at||a.timestamp||null })); }
function deriveHealth({ runtime, missions, evidence, pressure }) { const reasons=[]; if(runtime.state!=='ready') reasons.push(`runtime:${runtime.state}`); if(pressure.level==='critical') reasons.push('host-pressure:critical'); const interrupted=missions.filter(m=>m.status==='interrupted').length; if(interrupted) reasons.push(`interrupted-missions:${interrupted}`); const unbound=evidence.filter(e=>!(e.id&&e.target&&e.sha256)).length; if(unbound) reasons.push(`unbound-evidence:${unbound}`); let level='healthy'; if(pressure.level==='critical'||runtime.state==='failed') level='critical'; else if(reasons.length) level='degraded'; return {level,reasons}; }
function deepClone(value){ return JSON.parse(JSON.stringify(value)); }
module.exports={AuroraMonolithViewModel,normalizeRuntime,normalizeMissions,normalizeEvidence,normalizePressure,deriveHealth};
