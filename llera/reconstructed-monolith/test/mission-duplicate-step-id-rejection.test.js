'use strict';

const assert = require('assert');
const { MissionEngine } = require('../src/mission-engine');

(async () => {
  let durable = null;
  const engine = new MissionEngine({
    load: async () => durable,
    save: async state => { durable = JSON.parse(JSON.stringify(state)); },
    now: () => 1770000000000
  });

  await engine.init();
  await assert.rejects(
    engine.createMission({
      title: 'ambiguous identity regression',
      goal: 'never allow checkpoint/recovery ambiguity',
      mode: 'work',
      steps: [
        { id: 'material-step', name: 'first material action' },
        { id: 'material-step', name: 'second material action' }
      ]
    }),
    /duplicate mission step id/
  );

  assert.deepStrictEqual(engine.listMissions(), []);
  assert.strictEqual(durable, null);

  const clean = await engine.createMission({
    title: 'unique identity control',
    goal: 'preserve valid mission creation',
    mode: 'work',
    steps: [
      { id: 'scope', name: 'scope' },
      { id: 'verify', name: 'verify', dependencies: ['scope'] }
    ]
  });
  assert.strictEqual(clean.steps.length, 2);
  assert.deepStrictEqual(clean.steps.map(step => step.id), ['scope', 'verify']);

  console.log('MISSION_DUPLICATE_STEP_ID_REJECTION_PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
