'use strict';
const assert=require('assert'); const {MonolithStartupRecoveryCoordinator}=require('../src/startup-recovery-coordinator');
(async()=>{
 const missionState={schema:1,missions:{m1:{id:'m1',status:'interrupted',toolTrace:[]},m2:{id:'m2',status:'completed',toolTrace:[]}},order:['m1','m2']};
 let runtimeStarts=0; const runtime={state:{state:'stopped',desiredModel:'LLera Core 80B'},snapshot(){return {...this.state}},async ensureRunning(model,reason){runtimeStarts++; this.state={state:'ready',desiredModel:model,model,reason,generation:1}; return {...this.state}}};
 const missionEngine={async init(){return JSON.parse(JSON.stringify(missionState))},listMissions(){return missionState.order.map(id=>JSON.parse(JSON.stringify(missionState.missions[id])))}}; let safe=false;
 const watchdog={async launchProfile(){return safe?{mode:'safe',disableAutoModelLoad:true}:{mode:'normal'}}};
 const c=new MonolithStartupRecoveryCoordinator({missionEngine,runtime,recoverySnapshots:{async restore({missionId}){return {missionId,verificationDebt:{tool:'write_file'},evidenceCount:2,digest:'a'.repeat(64)}}},watchdog,resolveDesiredModel:async({runtime})=>runtime.desiredModel||'LLera Pro 20B'});
 const normal=await c.start(); assert.equal(normal.runtimeStarted,true); assert.equal(normal.desiredModel,'LLera Core 80B'); assert.deepStrictEqual(normal.interruptedMissions,['m1']); assert.equal(normal.recovery[0].restored,true);
 safe=true; const sm=await c.start(); assert.equal(sm.runtimeStarted,false); assert.equal(runtimeStarts,1);
 safe=false; const c2=new MonolithStartupRecoveryCoordinator({missionEngine,runtime,recoverySnapshots:{restore:async()=>{throw new Error('snapshot integrity mismatch')}},watchdog,resolveDesiredModel:async()=> 'LLera Pro 20B'});
 const partial=await c2.start(); assert.equal(partial.recovery[0].restored,false); assert.match(partial.recovery[0].reason,/integrity mismatch/); assert.equal(partial.runtime.model,'LLera Pro 20B');
 console.log('MONOLITH startup recovery PASS',{interruptedMissionRestore:true,desiredModelResume:true,watchdogSafeModeStopsAutoload:true,corruptSnapshotIsolated:true});
})().catch(e=>{console.error(e);process.exit(1)});
