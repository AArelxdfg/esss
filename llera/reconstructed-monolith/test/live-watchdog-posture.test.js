'use strict';
const assert=require('assert');
const {MonolithProductCoordinator}=require('../src/monolith-product-coordinator');

(async()=>{
 let safe=false; let mutatingCalls=0; let observationCalls=0; let updates=0; let finals=0;
 const startupRecovery={
   async start(){return {ok:true,safeMode:false,runtimeStarted:true,desiredModel:'core-80b',interruptedMissions:[],recovery:[]};},
   async watchdogPosture(){return {safeMode:safe,profile:{mode:safe?'safe':'normal'}};}
 };
 const p=new MonolithProductCoordinator({
   startupRecovery,
   hostguardRuntime:{async sample(){return {state:'normal',policy:{pressure:'normal'},actions:[]};}},
   missionTools:{async invoke({tool}){if(tool==='read_file')observationCalls++;else mutatingCalls++;return {ok:true};}},
   finalizer:{async finalize(){finals++;return {ok:true,publishable:true};}},
   verifiedLearning:null,
   updateInstall:{async apply(){updates++;return {ok:true,version:'x'};}},
   viewModel:{async snapshot(){return {}; }},
   clock:()=> 't'
 });
 await p.boot();
 assert.strictEqual(p.status().safeMode,false);
 await p.invokeMissionTool({missionId:'m1',stepId:'s1',tool:'write_file',args:{}});
 assert.strictEqual(mutatingCalls,1);
 safe=true;
 const blocked=await p.invokeMissionTool({missionId:'m1',stepId:'s2',tool:'write_file',args:{}});
 assert.strictEqual(blocked.blocked,true);
 assert.strictEqual(blocked.reason,'watchdog_safe_mode_read_only');
 assert.strictEqual(mutatingCalls,1);
 const read=await p.invokeMissionTool({missionId:'m1',stepId:'s3',tool:'read_file',args:{}});
 assert.strictEqual(read.ok,true);
 assert.strictEqual(observationCalls,1);
 const fin=await p.finalizeMission({missionId:'m1',claim:'x',learn:false});
 assert.strictEqual(fin.reason,'watchdog_safe_mode');
 assert.strictEqual(finals,0);
 const upd=await p.applyUpdate({manifest:{version:'x'}});
 assert.strictEqual(upd.reason,'watchdog_safe_mode');
 assert.strictEqual(updates,0);
 const ui=await p.uiSnapshot();
 assert.strictEqual(ui.productLifecycle.safeMode,true);
 safe=false;
 const stillBlocked=await p.invokeMissionTool({missionId:'m1',stepId:'s4',tool:'write_file',args:{}});
 assert.strictEqual(stillBlocked.blocked,true);
 assert.strictEqual(mutatingCalls,1);
 assert.strictEqual(p.audit.filter(x=>x.type==='watchdog-safe-mode-enter').length,1);
 console.log('live watchdog posture PASS',{dynamicEntry:true,readOnlyGate:true,finalizeBlocked:true,updateBlocked:true,oneWayLatch:true});
})().catch(e=>{console.error(e);process.exit(1);});
