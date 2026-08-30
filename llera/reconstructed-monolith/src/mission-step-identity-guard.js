'use strict';

function missionStepIdentityReport(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return { ok: false, code: 'MISSION_STEPS_REQUIRED', duplicates: [], invalidIds: [] };
  }

  const seen = new Set();
  const duplicates = new Set();
  const invalidIds = [];

  for (let index = 0; index < steps.length; index += 1) {
    const id = steps[index] && steps[index].id;
    if (typeof id !== 'string' || id.trim() === '') {
      invalidIds.push(index);
      continue;
    }
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }

  if (invalidIds.length) {
    return { ok: false, code: 'MISSION_STEP_ID_INVALID', duplicates: [...duplicates], invalidIds };
  }
  if (duplicates.size) {
    return { ok: false, code: 'MISSION_STEP_ID_COLLISION', duplicates: [...duplicates].sort(), invalidIds: [] };
  }
  return { ok: true, code: 'MISSION_STEP_IDENTITY_OK', duplicates: [], invalidIds: [] };
}

function assertMissionStepIdentity(steps) {
  const report = missionStepIdentityReport(steps);
  if (report.ok) return report;
  const error = new Error(report.code === 'MISSION_STEP_ID_COLLISION'
    ? `duplicate mission step id: ${report.duplicates.join(',')}`
    : report.code === 'MISSION_STEP_ID_INVALID'
      ? `invalid mission step id at index: ${report.invalidIds.join(',')}`
      : 'mission steps are required');
  error.code = report.code;
  error.details = report;
  throw error;
}

module.exports = { missionStepIdentityReport, assertMissionStepIdentity };
