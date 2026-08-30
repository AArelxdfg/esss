'use strict';
const assert = require('assert');
const { HostguardRuntimeCoordinator } = require('../src/hostguard-runtime-coordinator');
const { HostInferenceGovernor } = require('../src/host-inference-governor');

class PressureGovernor {
  update(sample) {
    const state = sample.state || 'normal';
    return { state, score: sample.score || 0, policy: this.policy(state), transition: null };
  }
  policy(state = 'critical') {
    return state === 'critical'
      ? { pressure:'critical', downloadWorkers:1, allowVisionLoad:false, unloadVision:true, runtimePriority:'BelowNormal' }
      : { pressure:'normal', downloadWorkers:8, allowVisionLoad:true, unloadVision:false, runtimePriority:'BelowNormal' };
  }
}

(async () => {
  const inferenceGovernor = new HostInferenceGovernor({ pressure:'normal' });
  let releaseRuntime;
  let runtimeEntered = false;
  const runtimeGate = new Promise(resolve => { releaseRuntime = resolve; });
  const runtime = {
    async applyHostPressure(level) {
      assert.strictEqual(level, 'critical');
      runtimeEntered = true;
      await runtimeGate;
      return { level, aborted:[], failures:[] };
    }
  };

  const coordinator = new HostguardRuntimeCoordinator({
    governor:new PressureGovernor(),
    runtime,
    inferenceGovernor
  });

  const applying = coordinator.sample({ state:'critical', score:0.99 });

  // Let sample() advance through the inference-governor await and enter the
  // deliberately blocked runtime preemption call.
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(runtimeEntered, true, 'runtime preemption should be in flight');
  assert.strictEqual(inferenceGovernor.snapshot().pressure, 'critical', 'critical admission fence must be active before runtime abort awaits');

  const escapedCouncil = inferenceGovernor.admit({ id:'council-race', className:'council', requestedTokens:1024 });
  const escapedAdversarial = inferenceGovernor.admit({ id:'adversarial-race', className:'adversarial', requestedTokens:1024 });
  assert.strictEqual(escapedCouncil.allow, false);
  assert.strictEqual(escapedCouncil.reason, 'class_blocked_by_host_pressure');
  assert.strictEqual(escapedAdversarial.allow, false);
  assert.strictEqual(escapedAdversarial.reason, 'class_blocked_by_host_pressure');

  releaseRuntime();
  const result = await applying;
  const actionTypes = result.actions.map(x => x.type);
  assert.ok(actionTypes.indexOf('inference-governor') < actionTypes.indexOf('runtime-pressure'), 'governor admission fence must precede runtime pressure action');

  console.log('MONOLITH HOSTGUARD critical admission fence PASS');
})().catch(err => { console.error(err); process.exit(1); });
