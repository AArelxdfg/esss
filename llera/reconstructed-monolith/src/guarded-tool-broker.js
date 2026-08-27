'use strict';

const { RESTORED_MONOLITH_TOOLS, ToolExecutionGuard } = require('./tool-surface');
const { MonolithCapabilityBroker } = require('./monolith-capability-broker');
const { FailureDoctrine } = require('./failure-doctrine');

const SPECIAL_CAPABILITIES = new Set([
  'vision_analyze_image','vision_ocr_screen','evidence_record','evidence_verify','update_status','host_pressure_status'
]);

class GuardedMonolithToolBroker {
  constructor({ historicalExecutor, capabilityBroker, guard = new ToolExecutionGuard(), failureDoctrine = new FailureDoctrine(), summarizeResult } = {}) {
    if (typeof historicalExecutor !== 'function') throw new Error('historicalExecutor(tool,args,context) is required');
    this.historicalExecutor = historicalExecutor;
    this.capabilityBroker = capabilityBroker || new MonolithCapabilityBroker();
    this.guard = guard;
    this.failureDoctrine = failureDoctrine;
    this.summarizeResult = summarizeResult || defaultSummary;
  }

  restore(toolTrace = []) {
    const guard = this.guard.restore(toolTrace);
    const failure = this.failureDoctrine && typeof this.failureDoctrine.restore === 'function'
      ? this.failureDoctrine.restore(toolTrace)
      : { restored: 0 };
    return { ...this.status(), restored: { guard, failure } };
  }

  status(context = {}) {
    const missionId = context.missionId || null;
    return {
      toolCount: RESTORED_MONOLITH_TOOLS.length,
      verificationDebt: this.guard.verificationDebt ? { ...this.guard.verificationDebt } : null,
      canFinalize: this.guard.canFinalize(),
      failureSummary: missionId && this.failureDoctrine && typeof this.failureDoctrine.summarize === 'function'
        ? this.failureDoctrine.summarize(missionId)
        : null
    };
  }

  async invoke(tool, args = {}, context = {}) {
    const decision = this.guard.decide(tool, args);
    if (!decision.allow) {
      return { ok:false, blocked:true, reason:decision.reason, fingerprint:decision.fingerprint || null,
        verificationDebt:this.guard.verificationDebt ? { ...this.guard.verificationDebt } : null };
    }
    try {
      const result = SPECIAL_CAPABILITIES.has(tool)
        ? await this.capabilityBroker.invoke(tool, args, context)
        : await this.historicalExecutor(tool, args, context);
      const trace = this.guard.record(tool, args, { ok:true, resultSummary:this.summarizeResult(result) });
      return { ok:true, blocked:false, result, trace,
        verificationDebt:this.guard.verificationDebt ? { ...this.guard.verificationDebt } : null,
        canFinalize:this.guard.canFinalize() };
    } catch (error) {
      const trace = this.guard.record(tool, args, {
        ok:false, resultSummary:`error:${String(error && error.message || error).slice(0,240)}`
      });
      const material = typeof decision.material === 'boolean' ? decision.material : Boolean(trace && trace.material);
      let failure = null;
      if (this.failureDoctrine && typeof this.failureDoctrine.recordFailure === 'function') {
        failure = this.failureDoctrine.recordFailure({
          missionId: context.missionId || 'unscoped-mission',
          stepId: context.stepId || 'unscoped-step',
          tool,
          args,
          error,
          material
        });
        if (trace && trace.recorded) trace.failure = failure;
      }
      return { ok:false, blocked:false, error:String(error && error.message || error), trace, failure,
        recovery: failure ? { ...failure.decision } : null,
        verificationDebt:this.guard.verificationDebt ? { ...this.guard.verificationDebt } : null,
        canFinalize:this.guard.canFinalize() };
    }
  }
}

function defaultSummary(value) {
  if (value == null) return String(value);
  if (typeof value === 'string') return value.slice(0,240);
  try { return JSON.stringify(value).slice(0,240); }
  catch { return Object.prototype.toString.call(value); }
}

module.exports = { SPECIAL_CAPABILITIES, GuardedMonolithToolBroker };
