'use strict';
const assert=require('assert');const{MonolithProductCoordinator}=require('../src/monolith-product-coordinator');
(async()=>{const calls=[];const c=new MonolithProductCoordinator({
startupRecovery:{start:async()=>{calls.push('startup');return{ok:true,safeMode:false,runtimeStarted:true,desiredModel:'qwen3-next-80b-q4km',interruptedMissions:['m-old'],recovery:[{missionId:'m-old',restored:true}]};}},
hostguardRuntime:{sample:async m=>{calls.push('host:'+m.state);return{state:m.state,policy:{pressure:m.state,downloadWorkers:m.state==='critical'?1:8,allowVisionLoad:m.state!=='critical'},actions:m.state==='critical'?[{type:'runtime-pressure'},{type:'vision-unload'}]:[]};}},
missionTools:{invoke:async i=>{calls.push('tool:'+i.tool);return{ok:true,blocked:false,context:i.context};}},
finalizer:{finalize:async()=>({ok:true,publishable:true})},verifiedLearning:{finalizeAndLearn:async i=>{calls.push('learn');return{ok:true,publishable:true,learned:true,missionId:i.missionId};}},
updateInstall:{apply:async i=>{calls.push('update');return{ok:true,verified:true,version:i.manifest.version};}},
viewModel:{snapshot:async()=>{calls.push('ui');return{schema:5401,health:{level:'healthy'},surfaces:{}};}},clock:()=> '2026-08-27T15:45:23+03:00'});
let pre=false;try{await c.invokeMissionTool({missionId:'m1',stepId:'s1',tool:'read_file'});}catch(e){pre=/not booted/.test(e.message);}assert.strictEqual(pre,true);
const b=await c.boot();assert.strictEqual(b.runtimeStarted,true);assert.strictEqual(b.recovery[0].restored,true);
const h=await c.sampleHost({state:'critical'});assert.strictEqual(h.policy.downloadWorkers,1);
const t=await c.invokeMissionTool({missionId:'m1',stepId:'s1',tool:'read_file',args:{path:'x'}});assert.strictEqual(t.context.hostState.policy.pressure,'critical');
const f=await c.finalizeMission({missionId:'m1',goal:'restore',claim:'verified'});assert.strictEqual(f.learned,true);
const u=await c.applyUpdate({manifest:{version:'5.4.0-reconstructed.2'}});assert.strictEqual(u.verified,true);
const ui=await c.uiSnapshot();assert.strictEqual(ui.productLifecycle.hostPressure,'critical');assert.strictEqual(ui.productLifecycle.desiredModel,'qwen3-next-80b-q4km');
assert.deepStrictEqual(calls.slice(0,6),['startup','host:critical','tool:read_file','learn','update','ui']);
const s=new MonolithProductCoordinator({startupRecovery:{start:async()=>({ok:true,safeMode:true,runtimeStarted:false,interruptedMissions:[],recovery:[]})},hostguardRuntime:{sample:async()=>({state:'normal',policy:{pressure:'normal'},actions:[]})},missionTools:{invoke:async i=>({ok:true,tool:i.tool})},finalizer:{finalize:async()=>({ok:true,publishable:true})},verifiedLearning:{finalizeAndLearn:async()=>({ok:true,learned:true})},updateInstall:{apply:async()=>({ok:true})},viewModel:{snapshot:async()=>({schema:5401,surfaces:{}})}});
await s.boot();assert.strictEqual((await s.invokeMissionTool({missionId:'m2',stepId:'s1',tool:'read_file'})).ok,true);const mut=await s.invokeMissionTool({missionId:'m2',stepId:'s1',tool:'write_file'});assert.strictEqual(mut.reason,'watchdog_safe_mode_read_only');assert.strictEqual((await s.finalizeMission({missionId:'m2',goal:'g',claim:'c'})).reason,'watchdog_safe_mode');assert.strictEqual((await s.applyUpdate({manifest:{version:'x'}})).reason,'watchdog_safe_mode');
console.log('MONOLITH product coordinator PASS',{orderedLifecycle:true,recoveryBootGate:true,hostPressureContext:true,verifiedLearningPath:true,signedUpdatePath:true,liveAuroraLifecycle:true,safeModeReadOnly:true});
})().catch(e=>{console.error(e);process.exit(1);});
