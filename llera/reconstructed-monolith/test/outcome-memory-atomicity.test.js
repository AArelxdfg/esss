'use strict';

const assert = require('assert');
const { OutcomeMemory } = require('../src/outcome-memory');

(async () => {
  let persisted = null;
  let failSave = false;
  let tick = 0;
  const memory = new OutcomeMemory({
    load: async () => persisted,
    save: async state => {
      if (failSave) throw new Error('simulated persistence failure');
      persisted = JSON.parse(JSON.stringify(state));
    },
    now: () => ++tick
  });
  await memory.init();

  failSave = true;
  await assert.rejects(
    () => memory.recordOutcome({missionId:'m-fail-save',goal:'rollback',status:'failed',failurePattern:'transient'}),
    /simulated persistence failure/
  );
  assert.deepStrictEqual(memory.snapshot().outcomes, []);
  assert.strictEqual(persisted, null);

  failSave = false;
  await Promise.all([
    memory.recordOutcome({missionId:'m-1',goal:'first',status:'failed',failurePattern:'network'}),
    memory.recordOutcome({missionId:'m-2',goal:'second',status:'partial',failurePattern:'retry'}),
    memory.recordOutcome({missionId:'m-3',goal:'third',status:'failed',failurePattern:'timeout'})
  ]);
  assert.deepStrictEqual(memory.snapshot().outcomes.map(x => x.missionId), ['m-1','m-2','m-3']);
  assert.deepStrictEqual(persisted.outcomes.map(x => x.missionId), ['m-1','m-2','m-3']);

  console.log('MONOLITH outcome memory atomicity PASS', {
    saveFailureRolledBack:true,
    concurrentMutationsSerialized:true,
    durableStateMatchesMemory:true
  });
})().catch(error => { console.error(error); process.exit(1); });
