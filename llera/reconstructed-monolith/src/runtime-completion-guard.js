'use strict';

function activeRuntimeGeneration(runtime, id) {
  if (!runtime || !id) return null;

  if (runtime.activeInference instanceof Map) {
    const task = runtime.activeInference.get(id);
    if (task && task.generation !== undefined && task.generation !== null) return task.generation;
  }

  if (typeof runtime.snapshot === 'function') {
    const snapshot = runtime.snapshot();
    const tasks = Array.isArray(snapshot && snapshot.activeInference) ? snapshot.activeInference : [];
    const task = tasks.find(x => x && x.id === id);
    if (task && task.generation !== undefined && task.generation !== null) return task.generation;
  }

  return null;
}

function canCompleteRuntimeInference(runtime, id, expectedGeneration) {
  if (expectedGeneration === null || expectedGeneration === undefined) {
    return { allow: true, activeGeneration: activeRuntimeGeneration(runtime, id), reason: 'legacy-unbound' };
  }

  const activeGeneration = activeRuntimeGeneration(runtime, id);
  if (activeGeneration === null || activeGeneration === undefined) {
    return { allow: false, activeGeneration: null, reason: 'runtime-generation-unobservable' };
  }

  if (activeGeneration !== expectedGeneration) {
    return { allow: false, activeGeneration, reason: 'runtime-generation-mismatch' };
  }

  return { allow: true, activeGeneration, reason: 'generation-match' };
}

module.exports = { activeRuntimeGeneration, canCompleteRuntimeInference };
