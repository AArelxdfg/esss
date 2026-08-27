'use strict';
const assert = require('assert');
const { HostguardRuntimeCoordinator } = require('../src/hostguard-runtime-coordinator');

class Governor {
  constructor() { this.state = 'normal'; }
  update(sample) { this.state = sample.state || this.state; return { state:this.state, score:sample.score || 0, policy:this.policy(), transition:sample.transition || null }; }
  policy() {
    if (this.state === 'critical') return { pressure:'critical', downloadWorkers:1, allowVisionLoad:false, unloadVision:true, preemptLowPriorityInference:true, runtimePriority:'BelowNormal' };
    if (this.state === 'elevated') return { pressure:'elevated', downloadWorkers:2, allowVisionLoad:true, unloadVision:false, preemptLowPriorityInference:false, runtimePriority:'BelowNormal' };
    return { pressure:'normal', downloadWorkers:8, allowVisionLoad:true, unloadVision:false, preemptLowPriorityInference:false, runtimePriority:'BelowNormal' };
  }
}

(async () => {
  const pressureCalls=[], workerCalls=[], unloadCalls=[], priorityCalls=[];
  const runtime = { async applyHostPressure(level) { pressureCalls.push(level); return { level, aborted:level === 'critical' ? ['council-1','adversarial-1'] : [] }; } };
  const coordinator = new HostguardRuntimeCoordinator({
    governor:new Governor(),
    runtime,
    vision:{ unload:async reason => unloadCalls.push(reason) },
    downloader:{ setWorkers:async n => workerCalls.push(n) },
    setRuntimePriority:async p => priorityCalls.push(p)
  });

  const normal = await coordinator.sample({state:'normal',score:0.2});
  assert.strictEqual(normal.policy.downloadWorkers,8);
  assert.strictEqual(coordinator.canStartVision(),true);
  const elevated = await coordinator.sample({state:'elevated',score:0.75});
  assert.strictEqual(elevated.policy.downloadWorkers,2);
  const critical = await coordinator.sample({state:'critical',score:0.95});
  assert.strictEqual(critical.policy.downloadWorkers,1);
  assert.strictEqual(coordinator.canStartVision(),false);
  assert.deepStrictEqual(critical.actions.find(a=>a.type==='runtime-pressure').aborted,['council-1','adversarial-1']);
  assert.strictEqual(unloadCalls.length,1);
  await coordinator.sample({state:'critical',score:0.93});
  assert.strictEqual(unloadCalls.length,1);
  assert.deepStrictEqual(workerCalls,[8,2,1]);
  await coordinator.sample({state:'normal',score:0.3});
  assert.strictEqual(coordinator.canStartVision(),true);
  await coordinator.sample({state:'critical',score:0.96});
  assert.strictEqual(unloadCalls.length,2);
  assert.deepStrictEqual(pressureCalls,['normal','elevated','critical','normal','critical']);
  assert.deepStrictEqual(priorityCalls,['BelowNormal']);
  console.log('HOSTGUARD runtime coordinator PASS', {pressureWiring:true,adaptiveWorkers:true,lowPriorityPreemption:true,visionUnloadLatched:true,visionAdmissionGate:true});
})().catch(err=>{ console.error(err); process.exit(1); });
