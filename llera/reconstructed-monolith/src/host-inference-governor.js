'use strict';

const PRIORITY_CLASS = Object.freeze({
  INTERACTIVE: 'interactive',
  MISSION: 'mission',
  COUNCIL: 'council',
  ADVERSARIAL: 'adversarial'
});

const PRESSURE_PROFILES = Object.freeze({
  normal: Object.freeze({
    totalConcurrency: 4,
    classConcurrency: Object.freeze({ interactive: 2, mission: 2, council: 1, adversarial: 1 }),
    tokenCaps: Object.freeze({ interactive: 8192, mission: 12288, council: 8192, adversarial: 8192 }),
    reasoning: Object.freeze({ interactive: 'minimal', mission: 'normal', council: 'normal', adversarial: 'normal' })
  }),
  elevated: Object.freeze({
    totalConcurrency: 3,
    classConcurrency: Object.freeze({ interactive: 2, mission: 1, council: 1, adversarial: 1 }),
    tokenCaps: Object.freeze({ interactive: 6144, mission: 8192, council: 4096, adversarial: 4096 }),
    reasoning: Object.freeze({ interactive: 'minimal', mission: 'normal', council: 'minimal', adversarial: 'minimal' })
  }),
  critical: Object.freeze({
    totalConcurrency: 2,
    classConcurrency: Object.freeze({ interactive: 2, mission: 1, council: 0, adversarial: 0 }),
    tokenCaps: Object.freeze({ interactive: 4096, mission: 4096, council: 0, adversarial: 0 }),
    reasoning: Object.freeze({ interactive: 'minimal', mission: 'minimal', council: 'disabled', adversarial: 'disabled' })
  })
});

class HostInferenceGovernor {
  constructor({ pressure = 'normal', now = () => Date.now() } = {}) {
    this.now = now;
    this.pressure = normalizePressure(pressure);
    this.active = new Map();
    this.history = [];
  }

  profile() {
    const p = PRESSURE_PROFILES[this.pressure];
    return JSON.parse(JSON.stringify({ pressure: this.pressure, ...p }));
  }

  applyPressure(level) {
    const next = normalizePressure(level);
    const previous = this.pressure;
    this.pressure = next;
    const victims = this.preemptionCandidates();
    const record = { from: previous, to: next, at: this.now(), victims: victims.map(x => x.id) };
    this.history.push(record);
    return {
      changed: previous !== next,
      profile: this.profile(),
      preemptionCandidates: victims.map(x => ({ ...x }))
    };
  }

  admit({ id, className = PRIORITY_CLASS.INTERACTIVE, requestedTokens = null } = {}) {
    if (!id || this.active.has(id)) return { allow: false, reason: 'unique_inference_id_required' };
    const cls = normalizeClass(className);
    const profile = PRESSURE_PROFILES[this.pressure];
    const cap = profile.classConcurrency[cls];
    if (cap <= 0) return { allow: false, reason: 'class_blocked_by_host_pressure', className: cls, pressure: this.pressure };
    if (this.active.size >= profile.totalConcurrency) return { allow: false, reason: 'host_concurrency_limit', pressure: this.pressure };
    const sameClass = [...this.active.values()].filter(x => x.className === cls).length;
    if (sameClass >= cap) return { allow: false, reason: 'class_concurrency_limit', className: cls, pressure: this.pressure };
    const tokenCap = profile.tokenCaps[cls];
    const maxTokens = requestedTokens == null ? tokenCap : Math.max(1, Math.min(tokenCap, Number(requestedTokens) || tokenCap));
    const admission = {
      allow: true,
      id,
      className: cls,
      pressure: this.pressure,
      maxTokens,
      reasoning: profile.reasoning[cls],
      startedAt: this.now()
    };
    this.active.set(id, admission);
    return { ...admission };
  }

  complete(id) {
    return this.active.delete(id);
  }

  preemptionCandidates() {
    if (this.pressure !== 'critical') return [];
    return [...this.active.values()]
      .filter(x => x.className === PRIORITY_CLASS.COUNCIL || x.className === PRIORITY_CLASS.ADVERSARIAL)
      .sort((a, b) => a.startedAt - b.startedAt);
  }

  snapshot() {
    return {
      pressure: this.pressure,
      profile: this.profile(),
      active: [...this.active.values()].map(x => ({ ...x })),
      preemptionCandidates: this.preemptionCandidates().map(x => x.id)
    };
  }
}

function normalizePressure(value) {
  const p = String(value || '').toLowerCase();
  if (!PRESSURE_PROFILES[p]) throw new Error(`unsupported host pressure ${value}`);
  return p;
}

function normalizeClass(value) {
  const c = String(value || '').toLowerCase();
  if (!Object.values(PRIORITY_CLASS).includes(c)) throw new Error(`unsupported inference class ${value}`);
  return c;
}

module.exports = { HostInferenceGovernor, PRIORITY_CLASS, PRESSURE_PROFILES };
