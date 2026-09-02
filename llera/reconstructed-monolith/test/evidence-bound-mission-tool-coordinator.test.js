'use strict';

const assert = require('node:assert');
const { EvidenceBoundMissionToolCoordinator } = require('../src/evidence-bound-mission-tool-coordinator');

(async () => {
  const mission = {
    id: 'mission_alpha',
    status: 'running',
    currentStepId: 'step_active',
    steps: [{ id: 'step_active' }],
    checkpoints: [],
    toolTrace: []
  };
  const evidenceId = 'ev_0123456789abcdef01234567';
  const entry = {
    id: evidenceId,
    missionId: mission.id,
    stepId: mission.currentStepId,
    tool: 'read_file',
    target: 'proof.txt',
    sha256: 'a'.repeat(64),
    bindingSha256: 'b'.repeat(64)
  };

  let brokerInvocations = 0;
  let appended = 0;
  let lastTrace = null;
  const missionEngine = {
    getMission: id => id === mission.id ? JSON.parse(JSON.stringify(mission)) : null,
    appendToolTrace: async (_missionId, trace) => {
      appended += 1;
      lastTrace = JSON.parse(JSON.stringify(trace));
      return { id: 'trace_1', ...trace };
    },
    checkpoint: async () => ({ id: 'checkpoint_1' })
  };
  const broker = {
    restore: () => ({}),
    status: () => ({ canFinalize: true, verificationDebt: null }),
    invoke: async () => {
      brokerInvocations += 1;
      return { ok: true, blocked: false, verificationDebt: null, trace: { material: false, observation: false } };
    }
  };
  const ledger = { snapshot: () => [entry] };
  const coordinator = new EvidenceBoundMissionToolCoordinator({ missionEngine, broker, evidenceLedger: ledger });

  const accepted = await coordinator.invoke({
    missionId: mission.id,
    stepId: mission.currentStepId,
    tool: 'read_file',
    args: { path: 'proof.txt' },
    evidenceIds: [evidenceId, evidenceId]
  });
  assert.strictEqual(accepted.ok, true);
  assert.strictEqual(brokerInvocations, 1);
  assert.strictEqual(appended, 1);
  assert.deepStrictEqual(lastTrace.evidenceIds, [evidenceId], 'durable trace must contain only validated, deduplicated evidence ids');

  entry.missionId = 'mission_beta';
  await assert.rejects(
    () => coordinator.invoke({
      missionId: mission.id,
      stepId: mission.currentStepId,
      tool: 'read_file',
      args: { path: 'proof.txt' },
      evidenceIds: [evidenceId]
    }),
    error => error && error.code === 'MISSION_EVIDENCE_MISSION_MISMATCH'
  );
  assert.strictEqual(brokerInvocations, 1, 'cross-mission evidence must fail before real tool execution');
  assert.strictEqual(appended, 1, 'cross-mission evidence must not contaminate durable tool trace');

  entry.missionId = mission.id;
  entry.stepId = 'step_other';
  await assert.rejects(
    () => coordinator.invoke({
      missionId: mission.id,
      stepId: mission.currentStepId,
      tool: 'read_file',
      evidenceIds: [evidenceId]
    }),
    error => error && error.code === 'MISSION_EVIDENCE_STEP_MISMATCH'
  );
  assert.strictEqual(brokerInvocations, 1);

  entry.stepId = mission.currentStepId;
  entry.tool = 'write_file';
  await assert.rejects(
    () => coordinator.invoke({
      missionId: mission.id,
      stepId: mission.currentStepId,
      tool: 'read_file',
      evidenceIds: [evidenceId]
    }),
    error => error && error.code === 'MISSION_EVIDENCE_TOOL_MISMATCH'
  );
  assert.strictEqual(brokerInvocations, 1);

  const noLedgerCoordinator = new EvidenceBoundMissionToolCoordinator({ missionEngine, broker });
  await assert.rejects(
    () => noLedgerCoordinator.invoke({
      missionId: mission.id,
      stepId: mission.currentStepId,
      tool: 'read_file',
      evidenceIds: [evidenceId]
    }),
    error => error && error.code === 'MISSION_EVIDENCE_LEDGER_REQUIRED'
  );
  assert.strictEqual(brokerInvocations, 1, 'missing evidence ledger must fail closed before execution');

  console.log('MONOLITH evidence-bound mission tool coordinator regression PASS');
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
