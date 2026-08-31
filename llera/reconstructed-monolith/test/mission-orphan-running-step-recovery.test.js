'use strict';
const assert=require('assert');
const {MissionEngine}=require('../src/mission-engine');
async function run(){
let now=2000;
let persisted={schema:1,order:['m1'],missions:{m1:{id:'m1',title:'Recover orphan step',goal:'Resume durable work',mode:'work',status:'running',createdAt:100,updatedAt:150,startedAt:110,completedAt:null,currentStepId:null,resumeCount:0,budget:{maxSteps:2,maxAttemptsPerStep:3},steps:[{id:'inspect',name:'Inspect',status:'running',dependencies:[],attempts:1,startedAt:120,completedAt:null,lastError:null,checkpointId:null},{id:'verify',name:'Verify',status:'pending',dependencies:['inspect'],attempts:0,startedAt:null,completedAt:null,lastError:null,checkpointId:null}],checkpoints:[],toolTrace:[]}}};
const load=async()=>JSON.parse(JSON.stringify(persisted));
const save=async s=>{persisted=JSON.parse(JSON.stringify(s));};
const engine=new MissionEngine({load,save,now:()=>++now});
await engine.init();
let m=engine.getMission('m1');
assert.equal(m.status,'interrupted'); assert.equal(m.currentStepId,null); assert.equal(m.steps[0].status,'pending'); assert.equal(m.steps[0].lastError,'interrupted:process-restart'); assert.equal(m.steps[0].attempts,1);
await engine.startMission('m1'); m=engine.getMission('m1'); assert.equal(m.resumeCount,1); assert.equal(engine.nextRunnableStep('m1').id,'inspect');
persisted={schema:1,order:['m2'],missions:{m2:{id:'m2',title:'Replay durable completion',goal:'Avoid duplicate work',mode:'work',status:'running',createdAt:100,updatedAt:150,startedAt:110,completedAt:null,currentStepId:null,resumeCount:0,budget:{maxSteps:1,maxAttemptsPerStep:3},steps:[{id:'apply',name:'Apply',status:'running',dependencies:[],attempts:1,startedAt:120,completedAt:null,lastError:null,checkpointId:null}],checkpoints:[{id:'cp_done',at:140,status:'running',currentStepId:'apply',completedStepIds:[],previousCheckpointId:null,stepAttempt:1,stepStartedAt:120,payload:{type:'step-complete',stepId:'apply',result:{ok:true}}}],toolTrace:[]}}};
const engine2=new MissionEngine({load,save,now:()=>++now}); await engine2.init(); const r=engine2.getMission('m2'); assert.equal(r.steps[0].status,'completed'); assert.equal(r.steps[0].checkpointId,'cp_done'); assert.equal(r.status,'completed'); assert(r.completedAt);
console.log(JSON.stringify({pass:true,orphanRunningStepRecovery:true,durableCompletionReplayWithoutCurrentStepId:true,noPermanentStuckRunningStep:true}));
}
run().catch(e=>{console.error(e.stack||e);process.exit(1);});
