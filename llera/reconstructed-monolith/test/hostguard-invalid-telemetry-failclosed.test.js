'use strict';
const assert=require('assert');
const {HostGuard}=require('../src/hostguard');

(async()=>{
  const calls={preempt:0,unload:0};
  const guard=new HostGuard({
    runtimeLifecycle:{async preemptLowPriority(reason){calls.preempt++;assert.equal(reason,'host-critical-pressure');}},
    visionController:{async unload(reason){calls.unload++;assert.equal(reason,'host-critical-pressure');}}
  });

  assert.equal(guard.classify({}), 'normal');
  assert.equal(guard.classify({commitPercent:'not-a-number'}), 'critical');
  assert.equal(guard.classify({diskActivePercent:Infinity}), 'critical');
  assert.equal(guard.classify({diskQueue:-1}), 'critical');
  assert.equal(guard.classify({pagesPerSec:NaN}), 'critical');
  assert.equal(guard.classify({cpuPercent:-0.1}), 'critical');

  const result=await guard.applyTelemetry({commitPercent:'corrupt',diskActivePercent:20,diskQueue:0,pagesPerSec:0,cpuPercent:10});
  assert.equal(result.pressure,'critical');
  assert.equal(result.downloadWorkers,1);
  assert.equal(result.visionAllowed,false);
  assert.equal(calls.preempt,1);
  assert.equal(calls.unload,1);
  assert.equal(guard.canLoadVision(),false);

  const recovered=await guard.applyTelemetry({commitPercent:40,diskActivePercent:20,diskQueue:0,pagesPerSec:0,cpuPercent:10});
  assert.equal(recovered.pressure,'normal');
  assert.equal(recovered.downloadWorkers,8);
  assert.equal(recovered.visionAllowed,true);

  console.log('HOSTGUARD invalid telemetry fail-closed PASS');
})().catch(err=>{console.error(err);process.exit(1)});
