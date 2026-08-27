'use strict';

const assert = require('assert');
const { HostInferenceGovernor } = require('../src/host-inference-governor');
const { HostguardRuntimeCoordinator } = require('../src/hostguard-runtime-coordinator');

class PressureGovernor {
  constructor() { this.state = 'normal'; }
  update(sample = {}) {
    this.state = sample.state || this.state;
    return { state: this.state, score: sample.score || 0, policy: this.policy() };
  }
  policy() {
    if (this.state === 'critical') return {
      pressure: 'critical', downloadWorkers: 1, allowVisionLoad: false,
      unloadVision: true, runtimePriority: 'BelowNormal'
    };
    if (this.state === 'elevated') return {
      pressure: 'elevated', downloadWorkers: 2, allowVisionLoad: true,
      unloadVision: false, runtimePriority: 'BelowNormal'
    };
    return {
      pressure: 'normal', downloadWorkers: 8, allowVisionLoad: true,
      unloadVision: false, runtimePriority: 'BelowNormal'
    };
  }
}

(async () => {
  let clock = 100;
  const inference = new HostInferenceGovernor({ now: () => ++clock });

  const interactive = inference.admit({ id: 'chat-1', className: 'interactive', requestedTokens: 16000 });
  assert.strictEqual(interactive.allow, true);
  assert.strictEqual(interactive.maxTokens, 8192);
  assert.strictEqual(interactive.reasoning, 'minimal');

  const council = inference.admit({ id: 'council-1', className: 'council', requestedTokens: 6000 });
  assert.strictEqual(council.allow, true);
  assert.strictEqual(council.reasoning, 'normal');

  const adversarial = inference.admit({ id: 'adv-1', className: 'adversarial', requestedTokens: 6000 });
  assert.strictEqual(adversarial.allow, true);

  const critical = inference.applyPressure('critical');
  assert.deepStrictEqual(critical.preemptionCandidates.map(x => x.id), ['council-1', 'adv-1']);

  const blockedCouncil = inference.admit({ id: 'council-2', className: 'council' });
  assert.strictEqual(blockedCouncil.allow, false);
  assert.strictEqual(blockedCouncil.reason, 'class_blocked_by_host_pressure');

  inference.complete('council-1');
  inference.complete('adv-1');
  const mission = inference.admit({ id: 'mission-1', className: 'mission', requestedTokens: 12000 });
  assert.strictEqual(mission.allow, true);
  assert.strictEqual(mission.maxTokens, 4096);
  assert.strictEqual(mission.reasoning, 'minimal');

  const workers = [];
  const runtimePressure = [];
  const coordinator = new HostguardRuntimeCoordinator({
    governor: new PressureGovernor(),
    runtime: {
      async applyHostPressure(level) {
        runtimePressure.push(level);
        return { aborted: level === 'critical' ? ['low-runtime-task'] : [] };
      }
    },
    inferenceGovernor: inference,
    downloader: { setWorkers: async n => workers.push(n) },
    vision: { unload: async () => {} },
    setRuntimePriority: async () => {}
  });

  await coordinator.sample({ state: 'normal' });
  await coordinator.sample({ state: 'elevated' });
  const integratedCritical = await coordinator.sample({ state: 'critical' });

  const action = integratedCritical.actions.find(x => x.type === 'inference-governor');
  assert.strictEqual(action.pressure, 'critical');
  assert.strictEqual(action.profile.totalConcurrency, 2);
  assert.strictEqual(action.profile.classConcurrency.council, 0);
  assert.deepStrictEqual(workers, [8, 2, 1]);
  assert.deepStrictEqual(runtimePressure, ['normal', 'elevated', 'critical']);

  const status = coordinator.status();
  assert.strictEqual(status.inference.pressure, 'critical');
  assert.strictEqual(status.inference.profile.tokenCaps.interactive, 4096);

  console.log('host inference governor parity PASS', {
    concurrencyGovernor: true,
    tokenCaps: true,
    reasoningProfiles: true,
    criticalCouncilBlock: true,
    hostguardRuntimeWiring: true
  });
})().catch(error => {
  console.error(error);
  process.exit(1);
});
