'use strict';

const { ToolExecutionGuard } = require('./tool-surface');

function deriveMissionVerificationDebt(mission = {}) {
  const trace = Array.isArray(mission.toolTrace) ? mission.toolTrace : [];
  const guard = new ToolExecutionGuard();
  const restored = guard.restore(trace);
  return restored.verificationDebt ? { ...restored.verificationDebt } : null;
}

function missionHasVerificationDebt(mission = {}) {
  return Boolean(deriveMissionVerificationDebt(mission));
}

module.exports = {
  deriveMissionVerificationDebt,
  missionHasVerificationDebt,
};
