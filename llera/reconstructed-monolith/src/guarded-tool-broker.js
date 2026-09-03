'use strict';

const { RESTORED_MONOLITH_TOOLS, MATERIAL_TOOLS, ToolExecutionGuard } = require('./tool-surface');
const { MonolithCapabilityBroker, CAPABILITY_TOOL_BINDINGS } = require('./monolith-capability-broker');
const { FailureDoctrine } = require('./failure-doctrine');

const SPECIAL_CAPABILITIES = new Set(Object.keys(CAPABILITY_TOOL_BINDINGS));
// Backwards-compatible export name, but the authorization boundary is now exactly
// the material-action boundary declared by tool-surface.js.
const SENSITIVE_ACTION_TOOLS = new Set(MATERIAL_TOOLS);

class GuardedMonolithToolBroker {
  constructor({ historicalExecutor, capabilityBroker, guard = new ToolExecutionGuard(), failureDoctrine = new FailureDoctrine(), summarizeResult, actionAuthorizer = null } = {}) {
    if (typeof historicalExecutor !== 'function') throw new Error('historicalExecutor(tool,args,context) is required');
    this.historicalExecutor = historicalExecutor;
    this.capabilityBroker = capabilityBroker || new MonolithCapabilityBroker();
    this.guard = guard;
    this.failureDoctrine = failureDoctrine;
    this.summarizeResult = summarizeResult || defaultSummary;
    this.actionAuthorizer = actionAuthorizer;
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
    const capabilityCoverage = this.capabilityBroker && typeof this.capabilityBroker.coverage === 'function'
      ? this.capabilityBroker.coverage()
      : null;
    return {
      toolCount: RESTORED_MONOLITH_TOOLS.length,
      specializedCapabilityCount: SPECIAL_CAPABILITIES.size,
      sensitiveActionCount: SENSITIVE_ACTION_TOOLS.size,
      sensitiveActionAuthorizationPresent: typeof this.actionAuthorizer === 'function',
      materialActionCount: MATERIAL_TOOLS.size,
      materialActionAuthorizationPresent: typeof this.actionAuthorizer === 'function',
      materialActionAuthorizationCoverageComplete: SENSITIVE_ACTION_TOOLS.size === MATERIAL_TOOLS.size && [...MATERIAL_TOOLS].every(tool => SENSITIVE_ACTION_TOOLS.has(tool)),
      capabilityCoverage,
      verificationDebt: this.guard.verificationDebt ? { ...this.guard.verificationDebt } : null,
      canFinalize: this.guard.canFinalize(),
      failureSummary: missionId && this.failureDoctrine && typeof this.failureDoctrine.summarize === 'function'
        ? this.failureDoctrine.summarize(missionId)
        : null
    };
  }

  async authorizeSensitiveAction(tool, args, context, decision) {
    if (!SENSITIVE_ACTION_TOOLS.has(tool)) return { allow:true, required:false };
    if (typeof this.actionAuthorizer !== 'function') {
      return { allow:false, required:true, reason:'action_authorization_required' };
    }
    try {
      const result = await this.actionAuthorizer({
        tool,
        args:{...args},
        context:{...context},
        material:Boolean(decision && decision.material),
        category:'material-action'
      });
      const allow = result === true || Boolean(result && result.allow === true);
      return allow
        ? { allow:true, required:true }
        : { allow:false, required:true, reason:'action_authorization_denied' };
    } catch (error) {
      return { allow:false, required:true, reason:'action_authorization_error', error:String(error && error.message || error) };
    }
  }

  async invoke(tool, args = {}, context = {}) {
    const decision = this.guard.decide(tool, args);
    if (!decision.allow) {
      return { ok:false, blocked:true, reason:decision.reason, fingerprint:decision.fingerprint || null,
        verificationDebt:this.guard.verificationDebt ? { ...this.guard.verificationDebt } : null };
    }

    const authorization = await this.authorizeSensitiveAction(tool, args, context, decision);
    if (!authorization.allow) {
      return {
        ok:false,
        blocked:true,
        reason:authorization.reason,
        authorizationRequired:Boolean(authorization.required),
        authorizationError:authorization.error || null,
        fingerprint:decision.fingerprint || null,
        verificationDebt:this.guard.verificationDebt ? { ...this.guard.verificationDebt } : null,
        canFinalize:this.guard.canFinalize()
      };
    }

    try {
      const result = SPECIAL_CAPABILITIES.has(tool)
        ? await this.capabilityBroker.invoke(tool, args, context)
        : await this.historicalExecutor(tool, args, context);

      const semanticOk = executionSucceeded(tool, result, { material:Boolean(decision && decision.material) });
      const trace = this.guard.record(tool, args, {
        ok:semanticOk,
        resultSummary:this.summarizeResult(result)
      });

      if (!semanticOk) {
        const error = semanticFailureMessage(tool, result);
        const material = typeof decision.material === 'boolean' ? decision.material : Boolean(trace && trace.material);
        let failure = null;
        if (this.failureDoctrine && typeof this.failureDoctrine.recordFailure === 'function') {
          failure = this.failureDoctrine.recordFailure({
            missionId: context.missionId || 'unscoped-mission',
            stepId: context.stepId || 'unscoped-step',
            tool,
            args,
            error:new Error(error),
            material
          });
          if (trace && trace.recorded) trace.failure = failure;
        }
        return {
          ok:false,
          blocked:false,
          semanticFailure:true,
          error,
          result,
          trace,
          failure,
          recovery: failure ? { ...failure.decision } : null,
          verificationDebt:this.guard.verificationDebt ? { ...this.guard.verificationDebt } : null,
          canFinalize:this.guard.canFinalize()
        };
      }

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

function executionSucceeded(tool, result, { material = false } = {}) {
  // Material actions must leave a structured, inspectable acknowledgement. A bare
  // primitive cannot carry target/result semantics and must never clear verification debt.
  if (material && (!result || typeof result !== 'object')) return false;

  if (!result || typeof result !== 'object') return true;
  if (result.ok === false || result.success === false || result.blocked === true) return false;

  const status = String(result.status || result.state || '').trim().toLowerCase();
  if (['failed','failure','error','errored','rejected','blocked','denied'].includes(status)) return false;

  if (tool === 'evidence_verify' && result.verified === false) return false;
  return true;
}

function semanticFailureMessage(tool, result) {
  if (result && typeof result === 'object') {
    const detail = result.error || result.message || result.reason || result.status || result.state;
    if (detail) return `${tool} reported failure: ${String(detail).slice(0,240)}`;
  }
  return `${tool} reported an unsuccessful result`;
}

function defaultSummary(value) {
  if (value == null) return String(value);
  if (typeof value === 'string') return value.slice(0,240);
  try { return JSON.stringify(value).slice(0,240); }
  catch { return Object.prototype.toString.call(value); }
}

module.exports = { SPECIAL_CAPABILITIES, SENSITIVE_ACTION_TOOLS, GuardedMonolithToolBroker, executionSucceeded };
