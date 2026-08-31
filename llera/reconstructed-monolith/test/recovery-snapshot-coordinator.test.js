'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { RecoverySnapshotCoordinator, stableStringify } = require('../src/recovery-snapshot-coordinator');

(async () => {
  let persisted = null;

  const missionState = {
    schema: 1,
    missions: {
      m1: {
        id: 'm1',
        status: 'interrupted',
        currentStepId: null,
        checkpoints: [{ id: 'cp1' }],
        toolTrace: [
          {
            id: 't1',
            tool: 'write_file',
            material: true,
            verification: false,
            outcome: 'success',
            evidenceIds: ['ev1']
          }
        ]
      }
    },
    order: ['m1']
  };

  const missionEngine = {
    snapshot: () => JSON.parse(JSON.stringify(missionState))
  };

  const toolGuard = {
    verificationDebt: null,
    restore(trace) {
      const lastMaterial = [...trace].reverse().find(x => x.material && x.outcome === 'success');
      const laterVerification = lastMaterial &&
        trace.slice(trace.indexOf(lastMaterial) + 1).some(x => x.verification && x.outcome === 'success');
      this.verificationDebt = lastMaterial && !laterVerification
        ? { tool: lastMaterial.tool, traceId: lastMaterial.id }
        : null;
    }
  };

  let evidenceStore = [{ id: 'ev1', target: 'x.txt', sha256: 'a'.repeat(64) }];
  let failEvidenceImport = false;
  const evidenceLedger = {
    export: () => JSON.parse(JSON.stringify(evidenceStore)),
    import: value => {
      evidenceStore = JSON.parse(JSON.stringify(value));
      if (failEvidenceImport) throw new Error('evidence import failed');
    }
  };

  const coordinator = new RecoverySnapshotCoordinator({
    missionEngine,
    toolGuard,
    evidenceLedger,
    saveSnapshot: async x => { persisted = JSON.parse(JSON.stringify(x)); },
    loadSnapshot: async () => JSON.parse(JSON.stringify(persisted)),
    now: () => 123456
  });

  const created = await coordinator.create({ missionId: 'm1', reason: 'process-exit' });
  assert.strictEqual(created.schema, 1);
  assert.strictEqual(created.integrity.algorithm, 'sha256');
  assert.strictEqual(created.integrity.digest.length, 64);
  assert.strictEqual(created.checkpointHead.id, 'cp1');
  assert.strictEqual(created.checkpointHead.index, 0);
  assert.strictEqual(created.checkpointHead.digest.length, 64);

  evidenceStore = [];
  const restored = await coordinator.restore({ missionId: 'm1' });
  assert.strictEqual(restored.restored, true);
  assert.strictEqual(restored.evidenceCount, 1);
  assert.deepStrictEqual(restored.verificationDebt, { tool: 'write_file', traceId: 't1' });
  assert.strictEqual(evidenceStore[0].id, 'ev1');

  persisted.toolTrace[0].tool = 'delete_file';
  let tamperBlocked = false;
  try {
    await coordinator.restore({ missionId: 'm1' });
  } catch (e) {
    tamperBlocked = /integrity mismatch/.test(e.message);
  }
  assert.strictEqual(tamperBlocked, true);

  persisted = JSON.parse(JSON.stringify(created));
  persisted.checkpointHead.id = 'forged-head';
  const { integrity, ...forgedPayload } = persisted;
  persisted.integrity.digest = crypto.createHash('sha256').update(stableStringify(forgedPayload)).digest('hex');
  await assert.rejects(() => coordinator.restore({ missionId:'m1' }), /checkpoint head mismatch/);

  persisted = JSON.parse(JSON.stringify(created));
  evidenceStore = [{ id:'prior-evidence' }];
  toolGuard.verificationDebt = { tool:'prior-tool', traceId:'prior-trace' };
  failEvidenceImport = true;
  await assert.rejects(() => coordinator.restore({ missionId:'m1' }), /evidence import failed/);
  assert.deepStrictEqual(evidenceStore, [{ id:'prior-evidence' }]);
  assert.deepStrictEqual(toolGuard.verificationDebt, { tool:'prior-tool', traceId:'prior-trace' });
  failEvidenceImport = false;

  console.log('recovery snapshot coordinator PASS', {
    integrityBound: true,
    verificationDebtRestored: true,
    evidenceRestored: true,
    tamperBlocked: true,
    checkpointHeadBound:true,
    atomicRestoreRollback:true
  });
})().catch(err => {
  console.error(err);
  process.exit(1);
});
