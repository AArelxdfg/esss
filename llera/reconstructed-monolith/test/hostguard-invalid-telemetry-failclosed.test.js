'use strict';

const assert = require('assert');
const { HostPressureHysteresis } = require('../src/hostguard-hysteresis');

let clock = 0;
const h = new HostPressureHysteresis({ dwellMs:1000, recoveryDwellMs:3000, now:() => clock });
const sample = (payload, advance=0) => { clock += advance; return h.update(payload); };

sample({ commitPercent:93 });
let s = sample({ commitPercent:93 }, 1000);
assert.strictEqual(s.state, 'critical');
assert.strictEqual(s.policy.allowVisionLoad, false);

const pendingBefore = s.pending;
s = sample({ commitPercent:NaN }, 5000);
assert.strictEqual(s.state, 'critical', 'invalid telemetry must not recover a critical host');
assert.strictEqual(s.telemetryValid, false);
assert.strictEqual(s.telemetryRejected, true);
assert.deepStrictEqual(s.invalidTelemetryFields, ['commitPercent']);
assert.strictEqual(s.policy.downloadWorkers, 1);
assert.strictEqual(s.policy.allowVisionLoad, false);
assert.deepStrictEqual(s.pending, pendingBefore, 'invalid telemetry must not mutate hysteresis pending state');

s = sample({}, 5000);
assert.strictEqual(s.state, 'critical', 'empty telemetry must not recover a critical host');
assert.strictEqual(s.telemetryValid, false);
assert.deepStrictEqual(s.invalidTelemetryFields, ['telemetry-empty']);

s = sample({ commitPercent:50, diskActivePercent:'not-a-number' }, 5000);
assert.strictEqual(s.state, 'critical', 'partially corrupt telemetry must fail closed');
assert.strictEqual(s.telemetryValid, false);
assert.deepStrictEqual(s.invalidTelemetryFields, ['diskActivePercent']);

sample({ commitPercent:50 });
s = sample({ commitPercent:50 }, 3000);
assert.strictEqual(s.state, 'normal', 'valid sustained recovery telemetry must still recover normally');
assert.strictEqual(s.telemetryValid, true);
assert.strictEqual(s.policy.downloadWorkers, 8);

console.log('HOSTGUARD invalid telemetry fail-closed PASS', {
  invalidTelemetryCannotDownshiftPressure:true,
  emptyTelemetryCannotDownshiftPressure:true,
  validRecoveryStillWorks:true
});
