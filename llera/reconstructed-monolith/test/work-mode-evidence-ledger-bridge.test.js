'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MissionEngine } = require('../src/mission-engine');
const { EvidenceLedger } = require('../src/evidence-ledger');
const { EvidenceBoundWorkModeService } = require('../app/services/evidence-bound-work-mode-service.cjs');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llera-work-evidence-'));
  try {
    const missions = new MissionEngine({ load: async () => null, save: async () => {} });
    await missions.init();
    const mission = await missions.createMission({
      title: 'Evidence continuity',
      goal: 'Bind existing evidence through the desktop Work Mode boundary',
      steps: ['Observe evidence-bound target']
    });

    const work = new EvidenceBoundWorkModeService({ missionEngine: missions, userData: root });
    await work.startMission(mission.id);
    await work.beginNextStep(mission.id);
    const active = missions.getMission(mission.id);
    assert(active.currentStepId);

    const relativeTarget = 'evidence/proof.txt';
    const physicalTarget = path.join(root, 'workspace', relativeTarget);
    fs.mkdirSync(path.dirname(physicalTarget), { recursive: true });
    const bytes = Buffer.from('MONOLITH EVIDENCE BRIDGE');
    fs.writeFileSync(physicalTarget, bytes);

    const ledger = new EvidenceLedger({
      missionId: mission.id,
      storagePath: path.join(root, 'evidence', `${mission.id}.json`)
    });
    const entry = ledger.add({
      stepId: active.currentStepId,
      tool: 'read_file',
      kind: 'observation',
      target: relativeTarget,
      bytes,
      summary: 'Known bytes for desktop Work Mode evidence continuity regression'
    });

    const observed = await work.invokeTool({
      missionId: mission.id,
      stepId: active.currentStepId,
      tool: 'read_file',
      args: { path: relativeTarget },
      evidenceIds: [entry.id, entry.id]
    });

    assert.strictEqual(observed.ok, true);
    assert.strictEqual(observed.result.text, bytes.toString('utf8'));
    assert.deepStrictEqual(observed.persistedTrace.evidenceIds, [entry.id]);

    const durable = missions.getMission(mission.id);
    const trace = durable.toolTrace.at(-1);
    assert.deepStrictEqual(trace.evidenceIds, [entry.id], 'desktop evidence IDs must survive into durable mission trace');

    const traceCountBeforeRejectedEvidence = durable.toolTrace.length;
    await assert.rejects(
      () => work.invokeTool({
        missionId: mission.id,
        stepId: active.currentStepId,
        tool: 'read_file',
        args: { path: 'does-not-exist.txt' },
        evidenceIds: ['ev_000000000000000000000000']
      }),
      error => error && error.code === 'MISSION_EVIDENCE_NOT_FOUND'
    );
    assert.strictEqual(
      missions.getMission(mission.id).toolTrace.length,
      traceCountBeforeRejectedEvidence,
      'unknown evidence must fail before tool execution can persist a trace'
    );

    console.log('MONOLITH desktop Work Mode evidence ledger bridge PASS', {
      evidenceId: entry.id,
      missionTraceBound: true,
      unknownEvidenceFailClosed: true
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
