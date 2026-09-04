'use strict';

const crypto = require('node:crypto');

const FAILURE_CLASS = Object.freeze({
  TRANSIENT: 'transient',
  STRATEGY: 'strategy',
  POLICY: 'policy',
  INTEGRITY: 'integrity',
  RESOURCE: 'resource',
  EXTERNAL: 'external',
});

const FAILURE_CLASSES = new Set(Object.values(FAILURE_CLASS));
const MAX_RESTORE_TRACE_ITEMS = 4096;

function stableFingerprint(value) {
  const stack = new WeakSet();
  const normalize = (input) => {
    if (input === null || typeof input !== 'object') return input;
    if (stack.has(input)) throw new TypeError('circular_failure_fingerprint_input');
    stack.add(input);
    try {
      if (Array.isArray(input)) return input.map(normalize);
      return Object.keys(input).sort().reduce((acc, key) => {
        acc[key] = normalize(input[key]);
        return acc;
      }, {});
    } finally {
      stack.delete(input);
    }
  };
  const encoded = JSON.stringify(normalize(value));
  if (typeof encoded !== 'string') throw new TypeError('failure_fingerprint_input_unserializable');
  return crypto.createHash('sha256').update(encoded).digest('hex');
}

function failureEventSeal(event) {
  return stableFingerprint({
    missionId: event.missionId,
    stepId: event.stepId,
    tool: event.tool,
    argsFingerprint: event.argsFingerprint,
    failureClass: event.failureClass,
    fingerprint: event.fingerprint,
    material: Boolean(event.material),
    message: typeof event.message === 'string' ? event.message : '',
    at: event.at,
  });
}

function failureEventIdentity(event) {
  if (event && typeof event.eventSeal === 'string' && /^[a-f0-9]{64}$/i.test(event.eventSeal)) {
    return `sealed:${event.eventSeal.toLowerCase()}`;
  }
  return `legacy:${stableFingerprint({
    missionId: typeof (event && event.missionId) === 'string' ? event.missionId : '',
    stepId: typeof (event && event.stepId) === 'string' ? event.stepId : '',
    tool: typeof (event && event.tool) === 'string' ? event.tool : '',
    argsFingerprint: typeof (event && event.argsFingerprint) === 'string' ? event.argsFingerprint.toLowerCase() : '',
    failureClass: event && event.failureClass,
    fingerprint: typeof (event && event.fingerprint) === 'string' ? event.fingerprint.toLowerCase() : '',
    material: Boolean(event && event.material),
    message: typeof (event && event.message) === 'string' ? event.message : '',
    at: event && event.at,
  })}`;
}

function validFailureTimestamp(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validBoundIdentity(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function structurallyValidFailure(event) {
  return Boolean(
    event &&
    typeof event === 'object' &&
    !Array.isArray(event) &&
    validBoundIdentity(event.missionId) &&
    validBoundIdentity(event.stepId) &&
    validBoundIdentity(event.tool) &&
    FAILURE_CLASSES.has(event.failureClass) &&
    typeof event.argsFingerprint === 'string' && /^[a-f0-9]{64}$/i.test(event.argsFingerprint) &&
    typeof event.fingerprint === 'string' && /^[a-f0-9]{64}$/i.test(event.fingerprint) &&
    (event.message === undefined || typeof event.message === 'string') &&
    (event.eventSeal === undefined || event.eventSeal === null || (typeof event.eventSeal === 'string' && /^[a-f0-9]{64}$/i.test(event.eventSeal))) &&
    validFailureTimestamp(event.at)
  );
}

function normalizePositiveRetryBudget(value, name) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

class FailureDoctrine {
  constructor({ maxSameFailure = 2, maxTransientRetries = 3, clock = () => Date.now() } = {}) {
    this.maxSameFailure = normalizePositiveRetryBudget(maxSameFailure, 'maxSameFailure');
    this.maxTransientRetries = normalizePositiveRetryBudget(maxTransientRetries, 'maxTransientRetries');
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    this.clock = clock;
    this.history = [];
    this.restoreDiagnostics = { restored: 0, legacyUnsealed: 0, rejected: 0 };
  }

  classify(error = {}) {
    const code = String(error.code || '').toUpperCase();
    const message = String(error.message || error).toLowerCase();
    if (error.integrity === true || /hash|signature|tamper|integrity/.test(message)) return FAILURE_CLASS.INTEGRITY;
    if (error.policy === true || /denied|blocked|protected path|confirmation required/.test(message)) return FAILURE_CLASS.POLICY;
    if (/enomem|out of memory|disk full|enospc|allocation|resource/.test(`${code} ${message}`)) return FAILURE_CLASS.RESOURCE;
    if (/timeout|timed out|econnreset|eai_again|429|503|temporar/.test(`${code} ${message}`)) return FAILURE_CLASS.TRANSIENT;
    if (/dns|network|upstream|external|unavailable/.test(`${code} ${message}`)) return FAILURE_CLASS.EXTERNAL;
    return FAILURE_CLASS.STRATEGY;
  }

  recordFailure({ missionId, stepId, tool, args = {}, error, material = false }) {
    if (!validBoundIdentity(missionId) || !validBoundIdentity(stepId) || !validBoundIdentity(tool)) {
      throw new Error('missionId, stepId and tool must be non-empty strings');
    }
    const failureClass = this.classify(error);
    const fingerprint = stableFingerprint({ tool, args, failureClass, code: error && error.code, message: error && error.message });
    const at = this.clock();
    if (!validFailureTimestamp(at)) throw new Error('FAILURE_DOCTRINE_CLOCK_INVALID');
    const event = {
      missionId, stepId, tool, argsFingerprint: stableFingerprint(args), failureClass, fingerprint,
      material: Boolean(material), message: String(error && error.message || error || ''), at,
    };
    event.eventSeal = failureEventSeal(event);
    this.history.push(event);
    return { ...event, decision: this.decide(event) };
  }

  decide(event) {
    const same = this.history.filter((x) => x.missionId === event.missionId && x.stepId === event.stepId && x.fingerprint === event.fingerprint).length;
    if (event.failureClass === FAILURE_CLASS.INTEGRITY) return { action: 'quarantine', retry: false, requiresVerification: true };
    if (event.failureClass === FAILURE_CLASS.POLICY) return { action: 'stop', retry: false, requiresHumanDecision: true };
    if (event.material) return { action: 'reobserve', retry: false, requiresVerification: true };
    if (same >= this.maxSameFailure) return { action: 'change-strategy', retry: false };
    if (event.failureClass === FAILURE_CLASS.RESOURCE) return { action: 'degrade', retry: true, profile: 'lower-pressure' };
    if (event.failureClass === FAILURE_CLASS.TRANSIENT) {
      const transientCount = this.history.filter((x) => x.missionId === event.missionId && x.stepId === event.stepId && x.failureClass === FAILURE_CLASS.TRANSIENT).length;
      return transientCount <= this.maxTransientRetries
        ? { action: 'retry-backoff', retry: true, backoffAttempt: transientCount }
        : { action: 'change-strategy', retry: false };
    }
    return { action: 'retry-once', retry: same < this.maxSameFailure };
  }

  restore(toolTrace = []) {
    const diagnostics = { restored: 0, legacyUnsealed: 0, rejected: 0 };
    if (!Array.isArray(toolTrace)) {
      diagnostics.rejected = 1;
      this.restoreDiagnostics = diagnostics;
      return { ...diagnostics };
    }
    if (toolTrace.length > MAX_RESTORE_TRACE_ITEMS) {
      diagnostics.rejected = toolTrace.length;
      this.restoreDiagnostics = diagnostics;
      return { ...diagnostics };
    }

    const known = new Set(this.history.map(failureEventIdentity));

    for (const item of toolTrace) {
      if (!item || item.ok !== false || !item.failure) continue;
      const failure = item.failure;

      if (!structurallyValidFailure(failure)) {
        diagnostics.rejected += 1;
        continue;
      }

      if (failure.eventSeal) {
        if (failureEventSeal(failure) !== failure.eventSeal.toLowerCase()) {
          diagnostics.rejected += 1;
          continue;
        }
      } else {
        diagnostics.legacyUnsealed += 1;
      }

      const restored = {
        missionId: failure.missionId,
        stepId: failure.stepId,
        tool: failure.tool,
        argsFingerprint: failure.argsFingerprint.toLowerCase(),
        failureClass: failure.failureClass,
        fingerprint: failure.fingerprint.toLowerCase(),
        material: Boolean(failure.material),
        message: failure.message || '',
        at: failure.at,
        eventSeal: failure.eventSeal ? failure.eventSeal.toLowerCase() : null,
      };

      const identity = failureEventIdentity(restored);
      if (known.has(identity)) continue;
      known.add(identity);
      this.history.push(restored);
      diagnostics.restored += 1;
    }

    this.restoreDiagnostics = diagnostics;
    return { ...diagnostics };
  }

  summarize(missionId) {
    const events = this.history.filter((x) => x.missionId === missionId);
    return events.reduce((acc, e) => {
      acc.total += 1;
      acc.byClass[e.failureClass] = (acc.byClass[e.failureClass] || 0) + 1;
      return acc;
    }, { total: 0, byClass: {} });
  }
}

module.exports = {
  FailureDoctrine,
  FAILURE_CLASS,
  MAX_RESTORE_TRACE_ITEMS,
  stableFingerprint,
  failureEventSeal,
  failureEventIdentity,
  structurallyValidFailure,
  validFailureTimestamp,
  validBoundIdentity,
};
