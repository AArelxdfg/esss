'use strict';

const assert = require('assert');
const { HostPressureHysteresis } = require('../src/hostguard-hysteresis');

function expectConfigFailure(options, pattern) {
  assert.throws(() => new HostPressureHysteresis(options), pattern);
}

expectConfigFailure({ elevatedExit:NaN }, /invalid hysteresis thresholds/);
expectConfigFailure({ elevatedExit:-0.01 }, /invalid hysteresis thresholds/);
expectConfigFailure({ criticalEnter:1.01 }, /invalid hysteresis thresholds/);
expectConfigFailure({ elevatedEnter:0.80, criticalExit:0.79 }, /invalid hysteresis thresholds/);
expectConfigFailure({ dwellMs:-1 }, /invalid hysteresis dwell/);
expectConfigFailure({ recoveryDwellMs:Infinity }, /invalid hysteresis dwell/);
expectConfigFailure({ now:Date.now() }, /now must be a function/);

let clock = 0;
const h = new HostPressureHysteresis({ dwellMs:1000, recoveryDwellMs:3000, now:() => clock });
function update(sample, advance=0) { clock += advance; return h.update(sample); }

update({commitPercent:73});
update({commitPercent:60},500);
assert.strictEqual(h.state,'normal');

update({commitPercent:75},100);
let s = update({commitPercent:75},1000);
assert.strictEqual(s.state,'elevated');
assert.strictEqual(s.policy.downloadWorkers,2);

s = update({commitPercent:91},100);
assert.strictEqual(s.state,'elevated');
s = update({commitPercent:70},300);
assert.strictEqual(s.state,'elevated');

update({commitPercent:93},100);
s = update({commitPercent:93},1000);
assert.strictEqual(s.state,'critical');
assert.strictEqual(s.policy.downloadWorkers,1);
assert.strictEqual(s.policy.allowVisionLoad,false);
assert.strictEqual(s.policy.unloadVision,true);
assert.strictEqual(s.policy.preemptLowPriorityInference,true);

update({commitPercent:50},100);
s = update({commitPercent:50},2000);
assert.strictEqual(s.state,'critical');
s = update({commitPercent:50},1000);
assert.strictEqual(s.state,'normal');
assert.strictEqual(s.policy.downloadWorkers,8);

update({diskQueue:8},100);
s = update({diskQueue:8},1000);
assert.strictEqual(s.state,'critical');

console.log('HOSTGUARD hysteresis PASS',{antiFlap:true,sustainedCriticalPreemption:true,slowRecovery:true,multiSignal:true,configValidation:true});
