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
const {VerifiedMissionFinalizer,evidenceIdsForMaterial,verificationTraceForMaterial}=require('../src/verified-mission-finalizer');
Module._load=originalLoad;

(async()=>{
  const mission={
    id:'m1',
    status:'completed',
    toolTrace:[
      {id:'t1',stepId:'s1',tool:'write_file',outcome:'success',material:true,verification:false,argumentsHash:'fp-1',scope:'path:x.txt',evidenceIds:['ev-action-1']},
      {id:'t2',stepId:'s1',tool:'read_file',outcome:'observed',material:false,verification:true,observation:true,verifiesFingerprint:'fp-1',scope:'path:x.txt',evidenceIds:['ev1']},
      {id:'t3',stepId:'s2',tool:'write_file',outcome:'success',material:true,verification:false,argumentsHash:'fp-2',scope:'path:y.txt',evidenceIds:['ev-action-2']},
      {id:'t4',stepId:'s2',tool:'hash_file',outcome:'verified',material:false,verification:true,observation:true,verifiesFingerprint:'fp-2',scope:'path:y.txt',evidenceIds:['ev2']}
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

  assert.strictEqual(verificationTraceForMaterial(mission.toolTrace,0).id,'t2');
  assert.strictEqual(verificationTraceForMaterial(mission.toolTrace,2).id,'t4');
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

  const directActionEvidenceOnly=[
    {id:'a',stepId:'s1',outcome:'success',material:true,argumentsHash:'fp-a',scope:'path:a.txt',evidenceIds:['ev-action']}
  ];
  assert.deepStrictEqual(evidenceIdsForMaterial(directActionEvidenceOnly,0),[]);

  const wrongFingerprint=[
    {id:'a',stepId:'s1',outcome:'success',material:true,argumentsHash:'fp-a',scope:'path:a.txt',evidenceIds:[]},
    {id:'v',stepId:'s1',outcome:'observed',verification:true,observation:true,verifiesFingerprint:'fp-other',scope:'path:a.txt',evidenceIds:['ev-wrong']}
  ];
  assert.deepStrictEqual(evidenceIdsForMaterial(wrongFingerprint,0),[]);

  const scopedHistorical=[
    {id:'a',stepId:'s1',outcome:'success',material:true,scope:'path:a.txt',evidenceIds:[]},
    {id:'v',stepId:'s1',outcome:'observed',verification:true,observation:true,scope:'path:a.txt',evidenceIds:['ev-scoped']}
  ];
  assert.deepStrictEqual(evidenceIdsForMaterial(scopedHistorical,0),['ev-scoped']);

  const noLeak=[
    {id:'a',stepId:'s1',outcome:'success',material:true,argumentsHash:'fp-a',scope:'path:a.txt',evidenceIds:[]},
    {id:'b',stepId:'s1',outcome:'success',material:true,argumentsHash:'fp-b',scope:'path:b.txt',evidenceIds:['ev-b-action']},
    {id:'c',stepId:'s1',outcome:'observed',verification:true,observation:true,verifiesFingerprint:'fp-b',scope:'path:b.txt',evidenceIds:['ev-c']}
  ];
  assert.deepStrictEqual(evidenceIdsForMaterial(noLeak,0),[]);
  assert.deepStrictEqual(evidenceIdsForMaterial(noLeak,1),['ev-c']);

  const crossStep=[
    {id:'a',stepId:'s1',outcome:'success',material:true,argumentsHash:'fp-a',scope:'path:a.txt',evidenceIds:[]},
    {id:'v',stepId:'s2',outcome:'observed',verification:true,observation:true,verifiesFingerprint:'fp-a',scope:'path:a.txt',evidenceIds:['ev-wrong']}
  ];
  assert.deepStrictEqual(evidenceIdsForMaterial(crossStep,0),[]);

  console.log('material evidence continuity PASS',{
    independentReObservationRequired:true,
    exactFingerprintBinding:true,
    historicalScopeBinding:true,
    noDirectActionEvidenceBypass:true,
    noCrossMaterialLeak:true,
    noCrossStepLeak:true,
    finalReceiptBound:true
  });
})().catch(error=>{console.error(error);process.exit(1);});
