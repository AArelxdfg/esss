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

function stableFingerprint(value) {
  const seen = new WeakSet();
  const normalize = (input) => {
    if (input === null || typeof input !== 'object') return input;
    if (seen.has(input)) return '[circular]';
    seen.add(input);
    if (Array.isArray(input)) return input.map(normalize);
    return Object.keys(input).sort().reduce((acc, key) => {
      acc[key] = normalize(input[key]);
      return acc;
    }, {});
  };
  return crypto.createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
}

class FailureDoctrine {
  constructor({ maxSameFailure = 2, maxTransientRetries = 3, clock = () => Date.now() } = {}) {
    this.maxSameFailure = maxSameFailure;
    this.maxTransientRetries = maxTransientRetries;
    this.clock = clock;
    this.history = [];
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
    if (!missionId || !stepId || !tool) throw new Error('missionId, stepId and tool are required');
    const failureClass = this.classify(error);
    const fingerprint = stableFingerprint({ tool, args, failureClass, code: error && error.code, message: error && error.message });
    const event = {
      missionId, stepId, tool, argsFingerprint: stableFingerprint(args), failureClass, fingerprint,
      material: Boolean(material), message: String(error && error.message || error || ''), at: this.clock(),
    };
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
    for (const item of toolTrace) {
      if (!item || item.ok !== false || !item.failure) continue;
      this.history.push({ ...item.failure });
    }
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

module.exports = { FailureDoctrine, FAILURE_CLASS, stableFingerprint };
