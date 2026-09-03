'use strict';
class HostGuard {
  constructor({runtimeLifecycle,visionController=null}={}) { this.runtimeLifecycle=runtimeLifecycle; this.visionController=visionController; this.pressure='normal'; this.lastTelemetry=null; this.events=[]; }
  _metric(t,key) { if(!Object.prototype.hasOwnProperty.call(t,key)) return 0; const value=Number(t[key]); return Number.isFinite(value)&&value>=0?value:null; }
  classify(t={}) { const values=['commitPercent','diskActivePercent','diskQueue','pagesPerSec','cpuPercent'].map(key=>this._metric(t,key)); if(values.some(value=>value===null))return'critical'; const [commit,disk,queue,pages,cpu]=values; if(commit>=92||disk>=98||queue>=6||pages>=1200)return'critical'; if(commit>=82||disk>=90||queue>=3||pages>=350||cpu>=92)return'elevated'; return'normal'; }
  downloadWorkers(){ return this.pressure==='critical'?1:this.pressure==='elevated'?2:8; }
  async applyTelemetry(telemetry={}) { this.lastTelemetry={...telemetry}; const next=this.classify(telemetry),changed=next!==this.pressure; this.pressure=next; const evt={type:'HOST_PRESSURE_EVENT',pressure:next,changed,telemetry:this.lastTelemetry}; this.events.push(evt); if(next==='critical'){ if(this.runtimeLifecycle&&typeof this.runtimeLifecycle.preemptLowPriority==='function') await this.runtimeLifecycle.preemptLowPriority('host-critical-pressure'); if(this.visionController&&typeof this.visionController.unload==='function') await this.visionController.unload('host-critical-pressure'); } return {...evt,downloadWorkers:this.downloadWorkers(),visionAllowed:next!=='critical'}; }
  canLoadVision(){ return this.pressure!=='critical'; }
}
module.exports={HostGuard};
