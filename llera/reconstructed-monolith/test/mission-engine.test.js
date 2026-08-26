'use strict';

const assert = require('assert');
const { MissionEngine } = require('../src/mission-engine');

async function run() {
  let persisted = null;
  let now = 1000;
  const save = async state => { persisted = JSON.parse(JSON.stringify(state)); };
  const load = async () => persisted && JSON.parse(JSON.stringify(persisted));

  const engine = new MissionEngine({ load, save, now: () => ++now });
  await engine.init();

  const mission = await engine.createMission({
    title: 'Restore MONOLITH mission parity',
    goal: 'Prove durable Work Mode checkpoints and restart recovery',
    mode: 'work',
    steps: [
      { id: 'scope', name: 'Scope' },
      { id: 'inspect', name: 'Inspect', dependencies: ['scope'] },
      { id: 'verify', name: 'Verify', dependencies: ['inspect'] }
    ],
    budget: { maxSteps: 3, maxAttemptsPerStep: 2 }
  });

  assert.equal(mission.status, 'pending');
  assert.equal(mission.mode, 'work');
  assert.equal(engine.nextRunnableStep(mission.id), null);

  await engine.startMission(mission.id);
  assert.equal(engine.nextRunnableStep(mission.id).id, 'scope');
  await engine.beginStep(mission.id, 'scope');
  await engine.appendToolTrace(mission.id, {
    tool: 'list_dir',
    argumentsHash: 'sha256:scope-args',
    outcome: 'success',
    material: false,
    evidenceIds: ['ev_scope_1']
  });
  await engine.completeStep(mission.id, 'scope', { ok: true });
  assert.equal(engine.nextRunnableStep(mission.id).id, 'inspect');

  await engine.beginStep(mission.id, 'inspect');
  await engine.appendToolTrace(mission.id, {
    tool: 'read_file',
    argumentsHash: 'sha256:inspect-args',
    outcome: 'success',
    material: false,
    evidenceIds: ['ev_inspect_1']
  });
  const beforeRestart = engine.getMission(mission.id);
  assert.equal(beforeRestart.status, 'running');
  assert.equal(beforeRestart.currentStepId, 'inspect');
  assert.equal(beforeRestart.steps.find(s => s.id === 'inspect').status, 'running');

  // Simulate process termination while Work Mode has an active step.
  const restarted = new MissionEngine({ load, save, now: () => ++now });
  await restarted.init();
  let recovered = restarted.getMission(mission.id);
  assert.equal(recovered.status, 'interrupted');
  assert.equal(recovered.currentStepId, null);
  assert.equal(recovered.steps.find(s => s.id === 'inspect').status, 'pending');
  assert.equal(recovered.steps.find(s => s.id === 'inspect').lastError, 'interrupted:process-restart');
  assert.equal(recovered.steps.find(s => s.id === 'inspect').attempts, 1);
  assert.equal(recovered.toolTrace.length, 2);
  assert(recovered.checkpoints.some(c => c.payload.type === 'step-complete' && c.payload.stepId === 'scope'));

  await restarted.startMission(mission.id);
  recovered = restarted.getMission(mission.id);
  assert.equal(recovered.resumeCount, 1);
  assert.equal(recovered.status, 'running');
  assert.equal(restarted.nextRunnableStep(mission.id).id, 'inspect');

  await restarted.beginStep(mission.id, 'inspect');
  await restarted.completeStep(mission.id, 'inspect', { recovered: true });
  assert.equal(restarted.nextRunnableStep(mission.id).id, 'verify');

  await restarted.beginStep(mission.id, 'verify');
  await restarted.appendToolTrace(mission.id, {
    tool: 'verification_observe',
    argumentsHash: 'sha256:verify-args',
    outcome: 'verified',
    verification: true,
    evidenceIds: ['ev_verify_1']
  });
  const finalMission = await restarted.completeStep(mission.id, 'verify', { pass: true });
  assert.equal(finalMission.status, 'completed');
  assert(finalMission.completedAt);
  assert.equal(finalMission.steps.filter(s => s.status === 'completed').length, 3);
  assert.equal(finalMission.toolTrace.length, 3);
  assert(finalMission.checkpoints.length >= 3);

  // Cyclic goal graphs must be rejected rather than becoming permanently stuck.
  let cycleRejected = false;
  try {
    await restarted.createMission({
      title: 'Cycle', goal: 'Reject cycle', mode: 'conversation',
      steps: [
        { id: 'a', name: 'A', dependencies: ['b'] },
        { id: 'b', name: 'B', dependencies: ['a'] }
      ]
    });
  } catch (err) {
    cycleRejected = /cycle/.test(String(err.message));
  }
  assert.equal(cycleRejected, true);

  console.log(JSON.stringify({
    pass: true,
    persistentMissions: true,
    durableCheckpoints: true,
    dependencyAwareGoalGraph: true,
    interruptedResume: true,
    toolTracePreservedAcrossRestart: true,
    attemptAccountingPreserved: true,
    cycleGuard: true,
    resumeCount: finalMission.resumeCount,
    checkpointCount: finalMission.checkpoints.length,
    traceCount: finalMission.toolTrace.length
  }));
}

run().catch(err => {
  console.error(err.stack || err);
  process.exit(1);
});
