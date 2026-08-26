'use strict';
class HostGuard {
  constructor({runtimeLifecycle,visionController=null}={}) { this.runtimeLifecycle=runtimeLifecycle; this.visionController=visionController; this.pressure='normal'; this.lastTelemetry=null; this.events=[]; }
  classify(t={}) { const commit=Number(t.commitPercent||0),disk=Number(t.diskActivePercent||0),queue=Number(t.diskQueue||0),pages=Number(t.pagesPerSec||0),cpu=Number(t.cpuPercent||0); if(commit>=92||disk>=98||queue>=6||pages>=1200)return'critical'; if(commit>=82||disk>=90||queue>=3||pages>=350||cpu>=92)return'elevated'; return'normal'; }
  downloadWorkers(){ return this.pressure==='critical'?1:this.pressure==='elevated'?2:8; }
  async applyTelemetry(telemetry={}) { this.lastTelemetry={...telemetry}; const next=this.classify(telemetry),changed=next!==this.pressure; this.pressure=next; const evt={type:'HOST_PRESSURE_EVENT',pressure:next,changed,telemetry:this.lastTelemetry}; this.events.push(evt); if(next==='critical'){ if(this.runtimeLifecycle&&typeof this.runtimeLifecycle.preemptLowPriority==='function') await this.runtimeLifecycle.preemptLowPriority('host-critical-pressure'); if(this.visionController&&typeof this.visionController.unload==='function') await this.visionController.unload('host-critical-pressure'); } return {...evt,downloadWorkers:this.downloadWorkers(),visionAllowed:next!=='critical'}; }
  canLoadVision(){ return this.pressure!=='critical'; }
}
module.exports={HostGuard};
