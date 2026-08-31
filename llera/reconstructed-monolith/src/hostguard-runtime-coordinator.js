'use strict';

class HostguardRuntimeCoordinator {
  constructor({ governor, runtime, vision = null, downloader = null, setRuntimePriority = null, inferenceGovernor = null, inferenceCoordinator = null } = {}) {
    if (!governor || typeof governor.update !== 'function' || typeof governor.policy !== 'function') throw new Error('governor.update()/policy() are required');
    if (!runtime || typeof runtime.applyHostPressure !== 'function') throw new Error('runtime.applyHostPressure() is required');
    if (vision != null && typeof vision.unload !== 'function') throw new Error('vision.unload() is required when vision controller is provided');
    if (downloader != null && typeof downloader.setWorkers !== 'function') throw new Error('downloader.setWorkers() is required when downloader controller is provided');
    if (setRuntimePriority != null && typeof setRuntimePriority !== 'function') throw new Error('setRuntimePriority must be a function when provided');
    if (inferenceGovernor != null && typeof inferenceGovernor.applyPressure !== 'function') throw new Error('inferenceGovernor.applyPressure() is required when inference governor is provided');
    if (inferenceCoordinator != null && typeof inferenceCoordinator.reconcileRuntimeAborts !== 'function') throw new Error('inferenceCoordinator.reconcileRuntimeAborts() is required when inference coordinator is provided');
    this.governor = governor;
    this.runtime = runtime;
    this.vision = vision;
    this.downloader = downloader;
    this.setRuntimePriority = setRuntimePriority;
    this.inferenceGovernor = inferenceGovernor;
    this.inferenceCoordinator = inferenceCoordinator;
    this.lastApplied = { pressure: null, downloadWorkers: null, runtimePriority: null, inferencePressure: null, visionUnloadedForCritical: false };
    this.history = [];
  }

  async sample(metrics = {}) {
    const snapshot = this.governor.update(metrics);
    const policy = snapshot.policy || this.governor.policy();
    const actions = [];

    // Fence new inference admissions before runtime preemption begins. Without
    // this ordering, applyHostPressure('critical') can await an abort callback
    // while the inference governor still exposes the previous profile. A new
    // Council/Adversarial task admitted in that window is absent from the
    // runtime victim snapshot and can survive CRITICAL pressure. Applying the
    // governor profile first closes that race; runtime cancellation then drains
    // the already-active low-priority work.
    if (this.inferenceGovernor && policy.pressure !== this.lastApplied.inferencePressure) {
      const governed = await this.inferenceGovernor.applyPressure(policy.pressure);
      actions.push({ type: 'inference-governor', pressure: policy.pressure, profile: governed && governed.profile ? governed.profile : null, preemptionCandidates: Array.isArray(governed && governed.preemptionCandidates) ? governed.preemptionCandidates.map(x => x.id || x) : [] });
      this.lastApplied.inferencePressure = policy.pressure;
    }

    if (policy.pressure !== this.lastApplied.pressure) {
      const pressureResult = await this.runtime.applyHostPressure(policy.pressure);
      const aborted = Array.isArray(pressureResult && pressureResult.aborted) ? [...pressureResult.aborted] : [];
      const failures = Array.isArray(pressureResult && pressureResult.failures)
        ? pressureResult.failures.map(x => ({ id: x && x.id || null, error: String(x && x.error || 'unknown preemption failure') }))
        : [];
      const deferred = Boolean(pressureResult && pressureResult.deferred);
      const degraded = Boolean(pressureResult && pressureResult.degraded) || failures.length > 0;
      actions.push({
        type: 'runtime-pressure',
        pressure: policy.pressure,
        aborted,
        failures,
        degraded,
        deferred,
        reason: deferred ? String(pressureResult && pressureResult.reason || 'runtime-transition') : null
      });

      if (this.inferenceCoordinator && aborted.length) {
        const reconciled = this.inferenceCoordinator.reconcileRuntimeAborts(aborted, { reason: `host-pressure-${policy.pressure}` });
        actions.push({ type: 'inference-reconcile', pressure: policy.pressure, reconciled: reconciled.map(x => x.id) });
      }

      if (failures.length) {
        actions.push({
          type: 'inference-preemption-degraded',
          pressure: policy.pressure,
          failures: failures.map(x => ({ ...x }))
        });
      }

      if (deferred) {
        // Do not mark runtime pressure as applied. RuntimeLifecycle deliberately
        // defers HOSTGUARD cancellation while a stop/recovery/model-switch owns
        // the inference drain. That transition can fail and reopen admission
        // with low-priority work still present. Keeping lastApplied.pressure
        // unchanged guarantees the next telemetry sample retries CRITICAL
        // preemption instead of treating a deferred pass as completed.
        actions.push({
          type: 'runtime-pressure-retry-pending',
          pressure: policy.pressure,
          reason: String(pressureResult && pressureResult.reason || 'runtime-transition')
        });
      } else {
        this.lastApplied.pressure = policy.pressure;
      }
    }

    if (this.downloader && policy.downloadWorkers !== this.lastApplied.downloadWorkers) {
      await this.downloader.setWorkers(policy.downloadWorkers);
      actions.push({ type: 'download-workers', workers: policy.downloadWorkers });
      this.lastApplied.downloadWorkers = policy.downloadWorkers;
    }

    if (this.setRuntimePriority && policy.runtimePriority !== this.lastApplied.runtimePriority) {
      await this.setRuntimePriority(policy.runtimePriority);
      actions.push({ type: 'runtime-priority', priority: policy.runtimePriority });
      this.lastApplied.runtimePriority = policy.runtimePriority;
    }

    if (policy.unloadVision) {
      if (this.vision && !this.lastApplied.visionUnloadedForCritical) {
        await this.vision.unload('host-pressure-critical');
        actions.push({ type: 'vision-unload', reason: 'host-pressure-critical' });
      }
      this.lastApplied.visionUnloadedForCritical = true;
    } else {
      this.lastApplied.visionUnloadedForCritical = false;
    }

    const record = { state: snapshot.state, score: snapshot.score, transition: snapshot.transition || null, policy: { ...policy }, actions };
    this.history.push(record);
    return record;
  }

  canStartVision() { return this.governor.policy().allowVisionLoad !== false; }
  status() {
    return {
      policy: { ...this.governor.policy() },
      canStartVision: this.canStartVision(),
      inference: this.inferenceGovernor && typeof this.inferenceGovernor.snapshot === 'function' ? this.inferenceGovernor.snapshot() : null,
      lastApplied: { ...this.lastApplied },
      samples: this.history.length
    };
  }
}

module.exports = { HostguardRuntimeCoordinator };
