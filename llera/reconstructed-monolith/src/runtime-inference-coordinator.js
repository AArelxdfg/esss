'use strict';

const { canCompleteRuntimeInference } = require('./runtime-completion-guard');

const LOW_PRIORITY_CLASSES = new Set(['council', 'adversarial']);

class RuntimeInferenceCoordinator {
  constructor({ runtime, governor } = {}) {
    if (!runtime || typeof runtime.registerInference !== 'function' || typeof runtime.completeInference !== 'function') {
      throw new Error('runtime registerInference/completeInference are required');
    }
    if (!governor || typeof governor.admit !== 'function' || typeof governor.complete !== 'function') {
      throw new Error('governor admit/complete are required');
    }
    this.runtime = runtime;
    this.governor = governor;
    this.active = new Map();
    this.completed = [];
  }

  begin({ id, className = 'interactive', requestedTokens = null, abort } = {}) {
    if (!id || this.active.has(id)) return { allow: false, reason: 'unique_inference_id_required' };
    if (typeof abort !== 'function') throw new Error('abort callback required');
    const admission = this.governor.admit({ id, className, requestedTokens });
    if (!admission || admission.allow !== true) return admission || { allow: false, reason: 'governor_rejected' };

    const priority = LOW_PRIORITY_CLASSES.has(admission.className) ? 'low'
      : admission.className === 'interactive' ? 'high' : 'normal';

    try {
      const runtimeTask = this.runtime.registerInference(id, { priority, abort });
      const record = {
        id,
        className: admission.className,
        priority,
        maxTokens: admission.maxTokens,
        reasoning: admission.reasoning,
        pressure: admission.pressure,
        startedAt: admission.startedAt,
        generation: runtimeTask && runtimeTask.generation
      };
      this.active.set(id, record);
      return { allow: true, ...record };
    } catch (error) {
      this.governor.complete(id);
      throw error;
    }
  }

  complete(id, expectedGeneration = null) {
    const local = this.active.get(id) || null;
    if (expectedGeneration !== null && expectedGeneration !== undefined) {
      if (!local || local.generation !== expectedGeneration) {
        this.completed.push({
          id,
          reason: 'stale-completion-ignored',
          expectedGeneration,
          activeGeneration: local && local.generation !== undefined ? local.generation : null
        });
        return false;
      }

      const runtimeGate = canCompleteRuntimeInference(this.runtime, id, expectedGeneration);
      if (!runtimeGate.allow) {
        this.completed.push({
          id,
          reason: 'runtime-generation-completion-blocked',
          expectedGeneration,
          activeGeneration: local.generation,
          runtimeGeneration: runtimeGate.activeGeneration,
          runtimeReason: runtimeGate.reason
        });
        return false;
      }
    }

    const runtimeRemoved = this.runtime.completeInference(id, expectedGeneration);
    const governorRemoved = this.governor.complete(id);
    const localRemoved = this.active.delete(id);
    if (runtimeRemoved || governorRemoved || localRemoved) {
      this.completed.push({ id, reason: 'completed', generation: local && local.generation !== undefined ? local.generation : null });
    }
    return Boolean(runtimeRemoved || governorRemoved || localRemoved);
  }

  reconcileRuntimeAborts(ids = [], { reason = 'host-pressure-preempted' } = {}) {
    const unique = [...new Set((ids || []).filter(Boolean))];
    const reconciled = [];
    for (const id of unique) {
      const local = this.active.get(id) || null;
      const governorRemoved = this.governor.complete(id);
      const localRemoved = this.active.delete(id);
      if (governorRemoved || localRemoved) {
        const entry = { id, reason, className: local && local.className || null };
        this.completed.push(entry);
        reconciled.push(entry);
      }
    }
    return reconciled;
  }

  snapshot() {
    return {
      active: [...this.active.values()].map(x => ({ ...x })),
      completed: this.completed.slice(-100).map(x => ({ ...x })),
      governor: typeof this.governor.snapshot === 'function' ? this.governor.snapshot() : null,
      runtime: typeof this.runtime.snapshot === 'function' ? this.runtime.snapshot() : null
    };
  }
}

module.exports = { RuntimeInferenceCoordinator, LOW_PRIORITY_CLASSES };
