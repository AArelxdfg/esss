'use strict';

const { RESTORED_MONOLITH_TOOLS, ToolExecutionGuard } = require('./tool-surface');
const { MonolithCapabilityBroker } = require('./monolith-capability-broker');

const SPECIAL_CAPABILITIES = new Set([
  'vision_analyze_image','vision_ocr_screen','evidence_record','evidence_verify','update_status','host_pressure_status'
]);

class GuardedMonolithToolBroker {
  constructor({ historicalExecutor, capabilityBroker, guard = new ToolExecutionGuard(), summarizeResult } = {}) {
    if (typeof historicalExecutor !== 'function') throw new Error('historicalExecutor(tool,args,context) is required');
    this.historicalExecutor = historicalExecutor;
    this.capabilityBroker = capabilityBroker || new MonolithCapabilityBroker();
    this.guard = guard;
    this.summarizeResult = summarizeResult || defaultSummary;
  }
  restore(toolTrace = []) { this.guard.restore(toolTrace); return this.status(); }
  status() {
    return {
      toolCount: RESTORED_MONOLITH_TOOLS.length,
      verificationDebt: this.guard.verificationDebt ? { ...this.guard.verificationDebt } : null,
      canFinalize: this.guard.canFinalize()
    };
  }
  async invoke(tool, args = {}, context = {}) {
    const decision = this.guard.decide(tool, args);
    if (!decision.allow) {
      return { ok:false, blocked:true, reason:decision.reason, fingerprint:decision.fingerprint || null,
        verificationDebt:this.guard.verificationDebt ? { ...this.guard.verificationDebt } : null };
    }
    let result;
    try {
      result = SPECIAL_CAPABILITIES.has(tool)
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
      return { ok:false, blocked:false, error:String(error && error.message || error), trace,
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
