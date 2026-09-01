'use strict';
const assert = require('assert');
const { MissionEngine } = require('../src/mission-engine');

const clone = value => JSON.parse(JSON.stringify(value));

function pendingMission(id, createdAt = 1) {
  return {
    id, title:id, goal:`goal-${id}`, mode:'work', status:'pending', createdAt, updatedAt:createdAt,
    startedAt:null, completedAt:null, currentStepId:null, resumeCount:0,
    budget:{maxSteps:1,maxAttemptsPerStep:3},
    steps:[{id:`${id}-step`,name:'step',status:'pending',dependencies:[],attempts:0,startedAt:null,completedAt:null,lastError:null,checkpointId:null}],
    checkpoints:[], toolTrace:[]
  };
}

(async () => {
  let now = 100;
  let persisted = null;
  let failNextSave = false;
  const engine = new MissionEngine({
    load:async () => clone(persisted),
    save:async state => {
      if (failNextSave) { failNextSave = false; throw new Error('durable store unavailable'); }
      persisted = clone(state);
    },
    now:() => ++now
  });
  await engine.init();
  const mission = await engine.createMission({title:'rollback',goal:'prove rollback',steps:[{id:'s1',name:'step'}]});
  const committedBeforeFailure = engine.snapshot();
  failNextSave = true;
  await assert.rejects(() => engine.startMission(mission.id), /durable store unavailable/);
  assert.deepStrictEqual(engine.snapshot(), committedBeforeFailure, 'failed save must not expose a partial mission mutation');
  assert.strictEqual(engine.getMission(mission.id).status, 'pending');
  await engine.startMission(mission.id);
  assert.strictEqual(engine.getMission(mission.id).status, 'running');

  let releaseFirstSave;
  let observeFirstSave;
  const firstSaveObserved = new Promise(resolve => { observeFirstSave = resolve; });
  const firstSaveGate = new Promise(resolve => { releaseFirstSave = resolve; });
  let concurrentSaveCount = 0;
  let concurrentPersisted = null;
  const concurrent = new MissionEngine({
    load:async () => null,
    save:async state => {
      concurrentSaveCount += 1;
      if (concurrentSaveCount === 1) { observeFirstSave(); await firstSaveGate; }
      concurrentPersisted = clone(state);
    },
    now:() => ++now
  });
  await concurrent.init();
  const firstCreate = concurrent.createMission({title:'first',goal:'first',steps:['one']});
  await firstSaveObserved;
  const secondCreate = concurrent.createMission({title:'second',goal:'second',steps:['two']});
  assert.strictEqual(concurrent.persistenceInProgress, true);
  assert.strictEqual(concurrentSaveCount, 1, 'second mutation must wait for the first durable write');
  assert.strictEqual(concurrent.listMissions().length, 0, 'uncommitted candidate state must not leak to readers');
  releaseFirstSave();
  await Promise.all([firstCreate, secondCreate]);
  assert.strictEqual(concurrent.persistenceInProgress, false);
  assert.strictEqual(concurrentSaveCount, 2);
  assert.strictEqual(concurrent.listMissions().length, 2);
  assert.strictEqual(Object.keys(concurrentPersisted.missions).length, 2);

  const beforeDuplicate = concurrent.snapshot();
  await assert.rejects(
    () => concurrent.createMission({title:'duplicate steps',goal:'reject',steps:[{id:'dup',name:'a'},{id:'dup',name:'b'}]}),
    /duplicate mission step id/
  );
  assert.deepStrictEqual(concurrent.snapshot(), beforeDuplicate);

  let normalizedPersisted = {
    schema:1,
    missions:{m1:pendingMission('m1',10),m2:pendingMission('m2',20)},
    order:['m1','m1','unknown']
  };
  const normalized = new MissionEngine({
    load:async () => clone(normalizedPersisted),
    save:async state => { normalizedPersisted = clone(state); },
    now:() => ++now
  });
  await normalized.init();
  assert.deepStrictEqual(normalized.snapshot().order, ['m1','m2']);

  const corrupt = {schema:1,missions:{bad:pendingMission('bad')},order:['bad']};
  corrupt.missions.bad.steps.push(clone(corrupt.missions.bad.steps[0]));
  let corruptSaveCalls = 0;
  const corruptEngine = new MissionEngine({load:async()=>clone(corrupt),save:async()=>{corruptSaveCalls += 1;}});
  await assert.rejects(() => corruptEngine.init(), /duplicate or invalid step id/);
  assert.strictEqual(corruptSaveCalls, 0);
  assert.deepStrictEqual(corruptEngine.snapshot(), {schema:1,missions:{},order:[]});

  const stale = pendingMission('stale');
  stale.status = 'running';
  stale.currentStepId = 'stale-step';
  stale.steps[0].status = 'running';
  stale.steps[0].attempts = 2;
  stale.steps[0].startedAt = 200;
  stale.checkpoints.push({
    id:'old-completion',at:150,status:'running',currentStepId:'stale-step',completedStepIds:[],
    previousCheckpointId:null,stepAttempt:1,stepStartedAt:100,
    payload:{type:'step-complete',stepId:'stale-step',result:{ok:true}}
  });
  let staleState = {schema:1,missions:{stale},order:['stale']};
  const staleEngine = new MissionEngine({load:async()=>clone(staleState),save:async state=>{staleState=clone(state);},now:()=>++now});
  await staleEngine.init();
  const repaired = staleEngine.getMission('stale');
  assert.strictEqual(repaired.steps[0].status, 'pending', 'stale prior-attempt completion must not replay');
  assert.strictEqual(repaired.steps[0].lastError, 'interrupted:process-restart');

  let initSaveFails = true;
  const interrupted = pendingMission('init-failure');
  interrupted.status = 'running';
  interrupted.currentStepId = interrupted.steps[0].id;
  interrupted.steps[0].status = 'running';
  interrupted.steps[0].attempts = 1;
  interrupted.steps[0].startedAt = 55;
  const initState = {schema:1,missions:{'init-failure':interrupted},order:['init-failure']};
  const initRollback = new MissionEngine({
    load:async()=>clone(initState),
    save:async()=>{if(initSaveFails)throw new Error('init persist failed');},
    now:()=>++now
  });
  await assert.rejects(() => initRollback.init(), /init persist failed/);
  assert.deepStrictEqual(initRollback.snapshot(), {schema:1,missions:{},order:[]});
  initSaveFails = false;
  await initRollback.init();
  assert.strictEqual(initRollback.getMission('init-failure').status, 'interrupted');

  console.log('mission persistence hardening PASS', {
    saveFailureRollback:true,
    concurrentMutationExcluded:true,
    uncommittedStateHidden:true,
    orderNormalized:true,
    duplicateStepIdsRejected:true,
    corruptInitNoPartialMutation:true,
    checkpointAttemptAndStartBound:true,
    initRepairRollback:true
  });
})().catch(error => { console.error(error); process.exit(1); });
