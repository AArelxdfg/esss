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

    if (policy.pressure !== this.lastApplied.pressure) {
      const pressureResult = await this.runtime.applyHostPressure(policy.pressure);
      const aborted = Array.isArray(pressureResult && pressureResult.aborted) ? [...pressureResult.aborted] : [];
      actions.push({ type: 'runtime-pressure', pressure: policy.pressure, aborted });
      if (this.inferenceCoordinator && aborted.length) {
        const reconciled = this.inferenceCoordinator.reconcileRuntimeAborts(aborted, { reason: `host-pressure-${policy.pressure}` });
        actions.push({ type: 'inference-reconcile', pressure: policy.pressure, reconciled: reconciled.map(x => x.id) });
      }
      this.lastApplied.pressure = policy.pressure;
    }

    if (this.inferenceGovernor && policy.pressure !== this.lastApplied.inferencePressure) {
      const governed = await this.inferenceGovernor.applyPressure(policy.pressure);
      actions.push({ type: 'inference-governor', pressure: policy.pressure, profile: governed && governed.profile ? governed.profile : null, preemptionCandidates: Array.isArray(governed && governed.preemptionCandidates) ? governed.preemptionCandidates.map(x => x.id || x) : [] });
      this.lastApplied.inferencePressure = policy.pressure;
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
