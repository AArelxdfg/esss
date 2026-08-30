'use strict';

const assert = require('assert');
const { OutcomeMemory } = require('../src/outcome-memory');

(async () => {
  let persisted = null;
  let clock = 5000;
  const memory = new OutcomeMemory({
    load: async () => persisted,
    save: async state => { persisted = JSON.parse(JSON.stringify(state)); },
    now: () => ++clock
  });
  await memory.init();

  await memory.recordOutcome({
    missionId:'m-skill-proof',
    goal:'perform verified material action',
    status:'completed',
    verification:{strict:true, adversarial:true, confidence:0.95, evidenceIds:['ev_a','ev_b']}
  });

  await assert.rejects(
    () => memory.proposeSkill({
      missionId:'m-skill-proof',
      name:'Evidence omission bypass',
      description:'must not become a candidate without skill-verifier evidence coverage',
      procedure:['act','verify'],
      evidenceIds:['ev_a'],
      verification:{strict:true, adversarial:true, confidence:0.95}
    }),
    /verification requires explicit evidence coverage/
  );

  const accepted = await memory.proposeSkill({
    missionId:'m-skill-proof',
    name:'Evidence-bound candidate',
    description:'skill verifier explicitly covers the candidate evidence',
    procedure:['act','verify'],
    evidenceIds:['ev_a'],
    verification:{strict:true, adversarial:true, confidence:0.95, evidenceIds:['ev_a']}
  });

  assert.deepStrictEqual(accepted.evidenceIds, ['ev_a']);
  assert.strictEqual(accepted.executable, false);
  assert.strictEqual(accepted.approvalRequired, true);
  assert.strictEqual(memory.snapshot().skillCandidates.length, 1, 'rejected bypass must not persist a skill candidate');

  console.log('MONOLITH skill verifier explicit evidence coverage PASS');
})().catch(err => { console.error(err); process.exit(1); });
