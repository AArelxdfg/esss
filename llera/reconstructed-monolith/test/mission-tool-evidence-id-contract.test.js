'use strict';

const assert = require('node:assert');
const { normalizeEvidenceIds, MissionToolCoordinator } = require('../src/mission-tool-coordinator');

(async () => {
  const validA = 'ev_0123456789abcdef01234567';
  const validB = 'ev_89abcdef0123456789abcdef';

  assert.deepStrictEqual(normalizeEvidenceIds([validA, validA, validB]), [validA, validB]);
  assert.throws(
    () => normalizeEvidenceIds('ev_not_an_array'),
    error => error && error.code === 'MISSION_TOOL_EVIDENCE_IDS_INVALID'
  );
  assert.throws(
    () => normalizeEvidenceIds(['EV_0123456789abcdef01234567']),
    error => error && error.code === 'MISSION_TOOL_EVIDENCE_ID_INVALID'
  );
  assert.throws(
    () => normalizeEvidenceIds(['ev_0123456789abcdef0123456z']),
    error => error && error.code === 'MISSION_TOOL_EVIDENCE_ID_INVALID'
  );

  let brokerInvocations = 0;
  let appended = 0;
  const mission = {
    id: 'mission_evidence_contract',
    status: 'running',
    currentStepId: 'step_active',
    steps: [{ id: 'step_active' }],
    checkpoints: [],
    toolTrace: []
  };
  const missionEngine = {
    getMission: id => id === mission.id ? JSON.parse(JSON.stringify(mission)) : null,
    appendToolTrace: async () => { appended += 1; return { id: 'trace_should_not_exist' }; },
    checkpoint: async () => ({ id: 'checkpoint_should_not_exist' })
  };
  const broker = {
    restore: () => ({}),
    status: () => ({ canFinalize: true, verificationDebt: null }),
    invoke: async () => {
      brokerInvocations += 1;
      return { ok: true, blocked: false, trace: { material: false, observation: false } };
    }
  };
  const coordinator = new MissionToolCoordinator({ missionEngine, broker });

  await assert.rejects(
    () => coordinator.invoke({
      missionId: mission.id,
      stepId: 'step_active',
      tool: 'read_file',
      args: { path: 'proof.txt' },
      evidenceIds: ['forged-evidence-id']
    }),
    error => error && error.code === 'MISSION_TOOL_EVIDENCE_ID_INVALID'
  );

  assert.strictEqual(brokerInvocations, 0, 'invalid evidence must fail before any real tool execution');
  assert.strictEqual(appended, 0, 'invalid evidence must never contaminate durable mission trace');

  console.log('MONOLITH mission evidence-id contract regression PASS');
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
