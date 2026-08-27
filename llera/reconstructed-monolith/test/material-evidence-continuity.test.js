'use strict';

const assert = require('assert');
const Module = require('module');
const path = require('path');

const finalizerPath = path.resolve(__dirname,'../src/verified-mission-finalizer.js');
const originalLoad = Module._load;
Module._load = function(request,parent,isMain){
  if(parent && parent.filename===finalizerPath && request==='./dual-verifier'){
    return {DualVerifier:class{
      verify({evidence}){
        return {
          ok:true,
          evidenceIds:evidence.map(e=>e.id),
          strict:{score:0.9},
          adversarial:{score:0.88}
        };
      }
    }};
  }
  return originalLoad.apply(this,arguments);
};
const {VerifiedMissionFinalizer,evidenceIdsForMaterial}=require('../src/verified-mission-finalizer');
Module._load=originalLoad;

(async()=>{
  const mission={
    id:'m1',
    status:'completed',
    toolTrace:[
      {id:'t1',stepId:'s1',tool:'write_file',outcome:'success',material:true,verification:false,evidenceIds:[]},
      {id:'t2',stepId:'s1',tool:'read_file',outcome:'observed',material:false,verification:true,evidenceIds:['ev1']},
      {id:'t3',stepId:'s2',tool:'write_file',outcome:'success',material:true,verification:false,evidenceIds:['ev2']}
    ]
  };
  const checkpoints=[];
  const finalizer=new VerifiedMissionFinalizer({
    missionEngine:{
      getMission:id=>id==='m1'?JSON.parse(JSON.stringify(mission)):null,
      checkpoint:async(id,payload)=>{checkpoints.push({id,payload});return {id:'cp-final',payload};}
    },
    missionToolCoordinator:{canFinalize:()=>true},
    evidenceLedger:{snapshot:()=>[
      {id:'ev1',missionId:'m1',stepId:'s1',target:'x.txt',sha256:'a'.repeat(64)},
      {id:'ev2',missionId:'m1',stepId:'s2',target:'y.txt',sha256:'b'.repeat(64)}
    ]},
    now:()=>12345
  });

  assert.deepStrictEqual(evidenceIdsForMaterial(mission.toolTrace,0),['ev1']);
  assert.deepStrictEqual(evidenceIdsForMaterial(mission.toolTrace,2),['ev2']);

  const result=await finalizer.finalize({missionId:'m1',claim:'verified behavior'});
  assert.strictEqual(result.ok,true);
  assert.strictEqual(result.publishable,true);
  assert.deepStrictEqual(result.receipt.evidenceIds,['ev1','ev2']);
  assert.deepStrictEqual(result.receipt.materialBindings,[
    {traceId:'t1',evidenceIds:['ev1']},
    {traceId:'t3',evidenceIds:['ev2']}
  ]);
  assert.strictEqual(checkpoints[0].payload.verification.materialBindings.length,2);

  const noLeak=[
    {id:'a',stepId:'s1',outcome:'success',material:true,evidenceIds:[]},
    {id:'b',stepId:'s1',outcome:'success',material:true,evidenceIds:['ev-b']},
    {id:'c',stepId:'s1',outcome:'observed',verification:true,evidenceIds:['ev-c']}
  ];
  assert.deepStrictEqual(evidenceIdsForMaterial(noLeak,0),[]);
  assert.deepStrictEqual(evidenceIdsForMaterial(noLeak,1),['ev-b']);

  const crossStep=[
    {id:'a',stepId:'s1',outcome:'success',material:true,evidenceIds:[]},
    {id:'v',stepId:'s2',outcome:'observed',verification:true,evidenceIds:['ev-wrong']}
  ];
  assert.deepStrictEqual(evidenceIdsForMaterial(crossStep,0),[]);

  console.log('material evidence continuity PASS',{
    postActionEvidence:true,
    noCrossMaterialLeak:true,
    noCrossStepLeak:true,
    finalReceiptBound:true
  });
})().catch(error=>{console.error(error);process.exit(1);});
