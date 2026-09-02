'use strict';

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
    this.lastRuntimeCleanupSignature = null;
  }

  _reconcileRuntimeCleanup() {
    if (typeof this.runtime.snapshot !== 'function') return [];
    const snapshot = this.runtime.snapshot();
    const cleanup = snapshot && snapshot.lastOrphanedInferenceCleanup;
    if (!cleanup) return [];

    const aborted = Array.isArray(cleanup.aborted) ? cleanup.aborted.filter(Boolean) : [];
    const failures = Array.isArray(cleanup.failures)
      ? cleanup.failures.map(item => item && item.id).filter(Boolean)
      : [];
    const ids = [...new Set([...aborted, ...failures])];

    // A cleanup belongs to the backend-death event that produced it, not to whatever
    // runtime generation happens to be current when the coordinator observes it.
    // Recovery can advance snapshot.generation while lastOrphanedInferenceCleanup is
    // still the previous event; keying only on the current generation would replay the
    // stale cleanup and call governor.complete() again. Prefer an event-bound cleanup
    // generation when newer runtimes provide one. Current RuntimeLifecycle always
    // records lastBackendExit for external-death cleanup, so use that stable backend
    // identity as the compatibility key. Only fall back to snapshot.generation for
    // older/fake snapshots that expose neither event-scoped signal.
    const exit = snapshot && snapshot.lastBackendExit;
    const cleanupGeneration = Number.isSafeInteger(cleanup.generation) ? cleanup.generation : null;
    const hasExitIdentity = Boolean(exit && (exit.pid || exit.at != null || exit.model || exit.kind));
    const eventIdentity = cleanupGeneration !== null
      ? { cleanupGeneration }
      : hasExitIdentity
        ? {
            exitPid: exit.pid ?? null,
            exitAt: exit.at ?? null,
            exitModel: exit.model || null,
            exitKind: exit.kind || null
          }
        : {
            runtimeGeneration: Number.isSafeInteger(snapshot && snapshot.generation) ? snapshot.generation : null
          };

    const signature = JSON.stringify({
      eventIdentity,
      at: cleanup.at ?? null,
      reason: cleanup.reason || null,
      ids
    });
    if (signature === this.lastRuntimeCleanupSignature) return [];
    this.lastRuntimeCleanupSignature = signature;
    if (!ids.length) return [];

    return this.reconcileRuntimeAborts(ids, {
      reason: cleanup.reason || 'runtime-orphan-cleanup'
    });
  }

  begin({ id, className = 'interactive', requestedTokens = null, abort } = {}) {
    // RuntimeLifecycle can independently discover that llama.cpp died and clear its
    // tracked inference set. Reconcile that cleanup before admitting new work so
    // stale coordinator/governor entries cannot permanently consume admission slots.
    this._reconcileRuntimeCleanup();

    if (!id || this.active.has(id)) return { allow: false, reason: 'unique_inference_id_required' };
    if (typeof abort !== 'function') throw new Error('abort callback required');
    const admission = this.governor.admit({ id, className, requestedTokens });
    if (!admission || admission.allow !== true) return admission || { allow: false, reason: 'governor_rejected' };

    const priority = LOW_PRIORITY_CLASSES.has(admission.className) ? 'low'
      : admission.className === 'interactive' ? 'high' : 'normal';

    try {
      const runtimeTask = this.runtime.registerInference(id, { priority, abort });
      const generation = runtimeTask && runtimeTask.generation;
      if (!Number.isSafeInteger(generation) || generation <= 0) {
        const error = new Error('runtime inference registration returned no valid generation');
        error.code = 'RUNTIME_INFERENCE_GENERATION_REQUIRED';
        throw error;
      }
      const record = {
        id,
        className: admission.className,
        priority,
        maxTokens: admission.maxTokens,
        reasoning: admission.reasoning,
        pressure: admission.pressure,
        startedAt: admission.startedAt,
        generation
      };
      this.active.set(id, record);
      return { allow: true, ...record };
    } catch (error) {
      this.governor.complete(id);
      throw error;
    }
  }

  complete(id, generation) {
    // RuntimeLifecycle may have removed this inference independently after an
    // external llama.cpp death. Reconcile that orphan-cleanup event before deciding
    // whether the caller's completion is stale, otherwise coordinator/governor state
    // can retain a consumed admission slot until another begin() happens.
    this._reconcileRuntimeCleanup();

    const local = this.active.get(id);
    if (!local || !Number.isSafeInteger(generation) || generation !== local.generation) return false;
    const runtimeRemoved = this.runtime.completeInference(id, generation);
    if (!runtimeRemoved) return false;
    const governorRemoved = this.governor.complete(id);
    const localRemoved = this.active.delete(id);
    if (runtimeRemoved || governorRemoved || localRemoved) this.completed.push({ id, reason: 'completed' });
    return Boolean(runtimeRemoved || governorRemoved || localRemoved);
  }

  reconcileRuntimeAborts(ids = [], { reason = 'host-pressure-preempted' } = {}) {
    const unique = [...new Set((ids || []).filter(Boolean))];
    const reconciled = [];
    for (const id of unique) {
      const local = this.active.get(id) || null;
      let governorRemoved = false;
      let governorError = null;
      try {
        governorRemoved = Boolean(this.governor.complete(id));
      } catch (error) {
        // Runtime-death reconciliation must never strand coordinator admission state
        // merely because governor cleanup itself is degraded. Remove the local record,
        // preserve the cleanup error for observability, and continue reconciling the
        // remaining inference IDs rather than aborting the entire cleanup batch.
        governorError = String(error?.message || error);
      }
      const localRemoved = this.active.delete(id);
      if (governorRemoved || localRemoved || governorError) {
        const entry = {
          id,
          reason,
          className: local && local.className || null,
          ...(governorError ? { governorCleanupError: governorError, degraded: true } : {})
        };
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
