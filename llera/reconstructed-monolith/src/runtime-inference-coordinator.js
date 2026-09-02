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
    this.pendingGovernorCleanup = new Map();
  }

  _retryGovernorCleanup() {
    if (!this.pendingGovernorCleanup.size) return [];
    const cleared = [];
    for (const [id, debt] of [...this.pendingGovernorCleanup]) {
      try {
        const removed = Boolean(this.governor.complete(id));
        this.pendingGovernorCleanup.delete(id);
        const entry = {
          id,
          reason: `${debt.reason || 'governor-cleanup'}-retry-cleared`,
          className: debt.className || null,
          governorRemoved: removed,
          cleanupAttempts: (debt.attempts || 1) + 1
        };
        this.completed.push(entry);
        cleared.push(entry);
      } catch (error) {
        this.pendingGovernorCleanup.set(id, {
          ...debt,
          attempts: (debt.attempts || 1) + 1,
          lastError: String(error?.message || error)
        });
      }
    }
    return cleared;
  }

  _reconcileRuntimeCleanup() {
    this._retryGovernorCleanup();
    if (typeof this.runtime.snapshot !== 'function') return [];
    const snapshot = this.runtime.snapshot();
    const cleanup = snapshot && snapshot.lastOrphanedInferenceCleanup;
    if (!cleanup) return [];

    const aborted = Array.isArray(cleanup.aborted) ? cleanup.aborted.filter(Boolean) : [];
    const failures = Array.isArray(cleanup.failures)
      ? cleanup.failures.map(item => item && item.id).filter(Boolean)
      : [];
    const ids = [...new Set([...aborted, ...failures])];

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

  _rollbackRuntimeRegistration(id, generation) {
    let resolvedGeneration = Number.isSafeInteger(generation) && generation > 0 ? generation : null;
    if (resolvedGeneration === null && typeof this.runtime.snapshot === 'function') {
      try {
        const snapshot = this.runtime.snapshot();
        const tasks = Array.isArray(snapshot && snapshot.activeInference) ? snapshot.activeInference : [];
        const task = tasks.find(item => item && item.id === id);
        if (task && Number.isSafeInteger(task.generation) && task.generation > 0) {
          resolvedGeneration = task.generation;
        }
      } catch (_) {
        // Rollback is best-effort here; the original admission error remains authoritative.
      }
    }
    if (resolvedGeneration === null) return false;
    try {
      return Boolean(this.runtime.completeInference(id, resolvedGeneration));
    } catch (_) {
      return false;
    }
  }

  begin({ id, className = 'interactive', requestedTokens = null, abort } = {}) {
    this._reconcileRuntimeCleanup();

    if (!id || this.active.has(id)) return { allow: false, reason: 'unique_inference_id_required' };
    if (typeof abort !== 'function') throw new Error('abort callback required');
    const admission = this.governor.admit({ id, className, requestedTokens });
    if (!admission || admission.allow !== true) return admission || { allow: false, reason: 'governor_rejected' };

    const priority = LOW_PRIORITY_CLASSES.has(admission.className) ? 'low'
      : admission.className === 'interactive' ? 'high' : 'normal';

    let runtimeTask = null;
    try {
      runtimeTask = this.runtime.registerInference(id, { priority, abort });
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
      this._rollbackRuntimeRegistration(id, runtimeTask && runtimeTask.generation);
      try {
        this.governor.complete(id);
      } catch (cleanupError) {
        const cleanupMessage = String(cleanupError?.message || cleanupError);
        this.pendingGovernorCleanup.set(id, {
          id,
          reason: 'admission-rollback-governor-cleanup',
          className: admission && admission.className || className || null,
          attempts: 1,
          lastError: cleanupMessage
        });
        error.governorCleanupError = cleanupMessage;
        error.cleanupDegraded = true;
      }
      throw error;
    }
  }

  complete(id, generation) {
    this._reconcileRuntimeCleanup();

    const local = this.active.get(id);
    if (!local || !Number.isSafeInteger(generation) || generation !== local.generation) return false;
    const runtimeRemoved = this.runtime.completeInference(id, generation);
    if (!runtimeRemoved) return false;
    let governorRemoved = false;
    try {
      governorRemoved = Boolean(this.governor.complete(id));
    } catch (error) {
      this.pendingGovernorCleanup.set(id, {
        id,
        reason: 'inference-complete-governor-cleanup',
        className: local.className || null,
        attempts: 1,
        lastError: String(error?.message || error)
      });
    }
    const localRemoved = this.active.delete(id);
    if (runtimeRemoved || governorRemoved || localRemoved) this.completed.push({ id, reason: 'completed', ...(this.pendingGovernorCleanup.has(id) ? { cleanupDegraded: true } : {}) });
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
        governorError = String(error?.message || error);
        this.pendingGovernorCleanup.set(id, {
          id,
          reason,
          className: local && local.className || null,
          attempts: 1,
          lastError: governorError
        });
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
      governorCleanupDebt: [...this.pendingGovernorCleanup.values()].map(x => ({ ...x })),
      governor: typeof this.governor.snapshot === 'function' ? this.governor.snapshot() : null,
      runtime: typeof this.runtime.snapshot === 'function' ? this.runtime.snapshot() : null
    };
  }
}

module.exports = { RuntimeInferenceCoordinator, LOW_PRIORITY_CLASSES };
