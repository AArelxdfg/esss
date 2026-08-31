'use strict';

const assert = require('assert');
const Module = require('module');
const path = require('path');

const brokerPath = path.resolve(__dirname, '../src/guarded-tool-broker.js');
const failurePath = path.resolve(__dirname, '../src/failure-doctrine.js');

class Guard {
  constructor() { this.history = []; this.verificationDebt = null; }
  restore(trace = []) { this.history = [...trace]; return { restored: trace.length }; }
  decide(tool) {
    if (tool === 'unknown') return { allow:false, reason:'unknown_tool' };
    return { allow:true, material:tool === 'write_file', observation:tool === 'read_file', fingerprint:`fp:${tool}` };
  }
  record(tool, args, {ok, resultSummary}) {
    const entry = { tool, args, ok:Boolean(ok), material:tool === 'write_file', observation:tool === 'read_file', resultSummary, recorded:true };
    this.history.push(entry);
    return entry;
  }
  canFinalize() { return !this.verificationDebt; }
}

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (parent && parent.filename === brokerPath && request === './tool-surface') {
    return { RESTORED_MONOLITH_TOOLS: Array.from({length:62}, (_,i)=>`tool_${i}`), MATERIAL_TOOLS:new Set(['write_file']), ToolExecutionGuard: Guard };
  }
  if (parent && parent.filename === brokerPath && request === './monolith-capability-broker') {
    return { CAPABILITY_TOOL_BINDINGS:{}, MonolithCapabilityBroker: class { async invoke() { return {ok:true}; } } };
  }
  return originalLoad.apply(this, arguments);
};

const { FailureDoctrine } = require(failurePath);
const { GuardedMonolithToolBroker } = require(brokerPath);
Module._load = originalLoad;

(async () => {
  const broker = new GuardedMonolithToolBroker({
    guard: new Guard(),
    failureDoctrine: new FailureDoctrine({ maxSameFailure: 2 }),
    actionAuthorizer:async () => true,
    historicalExecutor: async (tool) => {
      if (tool === 'read_file') { const e = new Error('temporary timeout'); e.code = 'ETIMEDOUT'; throw e; }
      if (tool === 'write_file') throw new Error('write failed');
      if (tool === 'hash_file') { const e = new Error('SHA-256 integrity mismatch'); e.integrity = true; throw e; }
      return { ok:true };
    }
  });

  const transient = await broker.invoke('read_file', {path:'a'}, {missionId:'m1', stepId:'s1'});
  assert.strictEqual(transient.failure.failureClass, 'transient');
  assert.strictEqual(transient.recovery.action, 'retry-backoff');
  assert.strictEqual(transient.recovery.retry, true);

  const material = await broker.invoke('write_file', {path:'a'}, {missionId:'m1', stepId:'s2'});
  assert.strictEqual(material.recovery.action, 'reobserve');
  assert.strictEqual(material.recovery.requiresVerification, true);
  assert.strictEqual(material.trace.failure.decision.action, 'reobserve');

  const integrity = await broker.invoke('hash_file', {path:'a'}, {missionId:'m1', stepId:'s3'});
  assert.strictEqual(integrity.failure.failureClass, 'integrity');
  assert.strictEqual(integrity.recovery.action, 'quarantine');
  assert.strictEqual(integrity.recovery.retry, false);

  const persistedTrace = [{ tool:'read_file', ok:false, failure:{ missionId:'m2', stepId:'s1', tool:'read_file', argsFingerprint:'a'.repeat(64), failureClass:'transient', fingerprint:'b'.repeat(64), material:false, message:'temporary timeout', at:1 } }];
  const restored = broker.restore(persistedTrace);
  assert.strictEqual(restored.restored.failure.restored, 1);
  assert.strictEqual(broker.status({missionId:'m2'}).failureSummary.total, 1);

  console.log('failure doctrine broker integration PASS', { transientBackoff:true, materialReobserve:true, integrityQuarantine:true, failureRestore:true });
})().catch(err => { console.error(err); process.exit(1); });
