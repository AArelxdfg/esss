'use strict';
const assert = require('assert');
const { MissionEngine } = require('../src/mission-engine');

(async () => {
  let persisted = null;
  let releaseSave = null;
  let blockNextSave = false;
  let now = 3000;
  const save = async state => {
    if (blockNextSave) {
      blockNextSave = false;
      await new Promise(resolve => { releaseSave = resolve; });
    }
    persisted = JSON.parse(JSON.stringify(state));
  };
  const load = async () => persisted && JSON.parse(JSON.stringify(persisted));
  const engine = new MissionEngine({ load, save, now: () => ++now });
  await engine.init();
  const mission = await engine.createMission({ title: 'Concurrent durable state', goal: 'Prevent overlapping mission persistence', mode: 'work', steps: [{ id: 'one', name: 'One' }] });
  await engine.startMission(mission.id);
  await engine.beginStep(mission.id, 'one');

  blockNextSave = true;
  const first = engine.checkpoint(mission.id, { type: 'manual', seq: 1 });
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(
    () => engine.appendToolTrace(mission.id, { tool: 'read_file', outcome: 'success' }),
    err => err && err.code === 'MISSION_PERSISTENCE_IN_PROGRESS'
  );
  const during = engine.getMission(mission.id);
  assert.equal(during.checkpoints.length, 1);
  assert.equal(during.toolTrace.length, 0, 'rejected concurrent mutation must not touch memory');
  releaseSave();
  await first;

  await engine.appendToolTrace(mission.id, { tool: 'read_file', outcome: 'success' });
  const restarted = new MissionEngine({ load, save, now: () => ++now });
  await restarted.init();
  const recovered = restarted.getMission(mission.id);
  assert.equal(recovered.checkpoints.length, 1);
  assert.equal(recovered.toolTrace.length, 1);
  console.log('MONOLITH mission concurrent persistence guard PASS');
})().catch(err => { console.error(err.stack || err); process.exit(1); });
