'use strict';

class HostPressureHysteresis {
  constructor({
    elevatedEnter = 0.72,
    elevatedExit = 0.62,
    criticalEnter = 0.88,
    criticalExit = 0.78,
    dwellMs = 1500,
    recoveryDwellMs = 5000,
    now = () => Date.now()
  } = {}) {
    if (!(0 <= elevatedExit && elevatedExit < elevatedEnter && elevatedEnter < criticalEnter && criticalExit < criticalEnter)) {
      throw new Error('invalid hysteresis thresholds');
    }
    this.thresholds = { elevatedEnter, elevatedExit, criticalEnter, criticalExit };
    this.dwellMs = dwellMs;
    this.recoveryDwellMs = recoveryDwellMs;
    this.now = now;
    this.state = 'normal';
    this.pending = null;
    this.lastTransitionAt = this.now();
  }

  update(sample = {}) {
    const telemetry = this._telemetryValidity(sample);
    if (!telemetry.valid) {
      const snap = this.snapshot(sample, this._stateFloorScore());
      snap.telemetryValid = false;
      snap.telemetryRejected = true;
      snap.invalidTelemetryFields = telemetry.invalidFields;
      return snap;
    }

    const pressure = this.score(sample);
    const desired = this._desired(pressure);
    const now = this.now();
    if (desired === this.state) {
      this.pending = null;
      const snap = this.snapshot(sample, pressure);
      snap.telemetryValid = true;
      return snap;
    }
    const isRecovery = this._rank(desired) < this._rank(this.state);
    const requiredDwell = isRecovery ? this.recoveryDwellMs : this.dwellMs;
    if (!this.pending || this.pending.state !== desired) {
      this.pending = { state: desired, since: now };
      const snap = this.snapshot(sample, pressure);
      snap.telemetryValid = true;
      return snap;
    }
    if (now - this.pending.since >= requiredDwell) {
      const previous = this.state;
      this.state = desired;
      this.lastTransitionAt = now;
      this.pending = null;
      const snap = this.snapshot(sample, pressure);
      snap.transition = { from: previous, to: desired, at: now };
      snap.telemetryValid = true;
      return snap;
    }
    const snap = this.snapshot(sample, pressure);
    snap.telemetryValid = true;
    return snap;
  }

  policy() {
    if (this.state === 'critical') return { pressure:'critical', downloadWorkers:1, allowVisionLoad:false, unloadVision:true, preemptLowPriorityInference:true, runtimePriority:'BelowNormal' };
    if (this.state === 'elevated') return { pressure:'elevated', downloadWorkers:2, allowVisionLoad:true, unloadVision:false, preemptLowPriorityInference:false, runtimePriority:'BelowNormal' };
    return { pressure:'normal', downloadWorkers:8, allowVisionLoad:true, unloadVision:false, preemptLowPriorityInference:false, runtimePriority:'BelowNormal' };
  }

  snapshot(sample = {}, score = this.score(sample)) {
    return { state:this.state, score, pending:this.pending ? { ...this.pending } : null, lastTransitionAt:this.lastTransitionAt, policy:this.policy() };
  }

  score(sample = {}) {
    const commit = clamp01(sample.commitPercent);
    const disk = clamp01(sample.diskActivePercent);
    const queue = clamp01((Number(sample.diskQueue) || 0) / 8);
    const paging = clamp01((Number(sample.pagesPerSec) || 0) / 2000);
    const cpu = clamp01(sample.cpuPercent);
    return Math.max(commit, disk * 0.92, queue * 0.90, paging * 0.88, cpu * 0.82);
  }

  _telemetryValidity(sample) {
    if (!sample || typeof sample !== 'object' || Array.isArray(sample)) {
      return { valid:false, invalidFields:['sample'] };
    }
    const fields = ['commitPercent','diskActivePercent','diskQueue','pagesPerSec','cpuPercent'];
    const present = fields.filter(field => Object.prototype.hasOwnProperty.call(sample, field));
    if (!present.length) return { valid:false, invalidFields:['telemetry-empty'] };
    const invalidFields = present.filter(field => !Number.isFinite(Number(sample[field])));
    return { valid:invalidFields.length === 0, invalidFields };
  }

  _stateFloorScore() {
    if (this.state === 'critical') return this.thresholds.criticalExit;
    if (this.state === 'elevated') return this.thresholds.elevatedExit;
    return 0;
  }

  _desired(score) {
    const t = this.thresholds;
    if (this.state === 'critical') {
      if (score >= t.criticalExit) return 'critical';
      if (score >= t.elevatedExit) return 'elevated';
      return 'normal';
    }
    if (this.state === 'elevated') {
      if (score >= t.criticalEnter) return 'critical';
      if (score >= t.elevatedExit) return 'elevated';
      return 'normal';
    }
    if (score >= t.criticalEnter) return 'critical';
    if (score >= t.elevatedEnter) return 'elevated';
    return 'normal';
  }

  _rank(state) { return state === 'critical' ? 2 : state === 'elevated' ? 1 : 0; }
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const normalized = n > 1 ? n / 100 : n;
  return Math.max(0, Math.min(1, normalized));
}

module.exports = { HostPressureHysteresis };
