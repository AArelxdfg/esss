'use strict';
class MonolithStartupRecoveryCoordinator {
  constructor({missionEngine,runtime,recoverySnapshots=null,watchdog=null,resolveDesiredModel,onSafeMode=null}={}) {
    if(!missionEngine||typeof missionEngine.init!=='function'||typeof missionEngine.listMissions!=='function') throw new Error('missionEngine init/listMissions are required');
    if(!runtime||typeof runtime.ensureRunning!=='function'||typeof runtime.snapshot!=='function') throw new Error('runtime ensureRunning/snapshot are required');
    if(recoverySnapshots!=null&&typeof recoverySnapshots.restore!=='function') throw new Error('recoverySnapshots.restore is required');
    if(watchdog!=null&&typeof watchdog.launchProfile!=='function') throw new Error('watchdog.launchProfile is required');
    if(typeof resolveDesiredModel!=='function') throw new Error('resolveDesiredModel is required');
    this.missionEngine=missionEngine; this.runtime=runtime; this.recoverySnapshots=recoverySnapshots; this.watchdog=watchdog; this.resolveDesiredModel=resolveDesiredModel; this.onSafeMode=onSafeMode; this.history=[];
  }
  async start(){
    const profile=this.watchdog?await this.watchdog.launchProfile():{mode:'normal'};
    const missionState=await this.missionEngine.init(); const missions=this.missionEngine.listMissions();
    const interrupted=missions.filter(m=>m&&m.status==='interrupted'); const recovery=[];
    for(const mission of interrupted){
      if(!this.recoverySnapshots){ recovery.push({missionId:mission.id,restored:false,reason:'snapshot-coordinator-unavailable'}); continue; }
      try{ const r=await this.recoverySnapshots.restore({missionId:mission.id}); recovery.push({missionId:mission.id,restored:true,...r}); }
      catch(e){ recovery.push({missionId:mission.id,restored:false,reason:String(e&&e.message||e)}); }
    }
    if(profile.mode==='safe'){
      if(this.onSafeMode) await this.onSafeMode({profile,interrupted,recovery});
      const result={ok:true,safeMode:true,runtimeStarted:false,profile:{...profile},interruptedMissions:interrupted.map(m=>m.id),recovery,missionState}; this.history.push(result); return JSON.parse(JSON.stringify(result));
    }
    const desiredModel=await this.resolveDesiredModel({runtime:this.runtime.snapshot(),missions,missionState});
    if(!desiredModel) throw new Error('resolveDesiredModel returned no model');
    const runtimeState=await this.runtime.ensureRunning(desiredModel,'startup-recovery');
    const result={ok:true,safeMode:false,runtimeStarted:true,desiredModel,runtime:runtimeState,interruptedMissions:interrupted.map(m=>m.id),recovery,missionState}; this.history.push(result); return JSON.parse(JSON.stringify(result));
  }
}
module.exports={MonolithStartupRecoveryCoordinator};
