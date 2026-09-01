'use strict';

const assert = require('assert');
const { CONTRACT, ReleaseCandidateGate } = require('../src/release-candidate-gate');

const allBehavior = Object.fromEntries(CONTRACT.requiredBehaviorGates.map(k => [k, true]));
const gate = new ReleaseCandidateGate();

function baseCandidate(overrides = {}) {
  return {
    toolCount: 62,
    behavior: allBehavior,
    tests: { node: true, regression: true, crossBuild: true },
    artifact: {
      path: 'LLera-MONOLITH-OMEGA-Reconstructed-x64.exe',
      kind: 'windows-x64', bytes: 7855104,
      sha256: 'f'.repeat(64), pe32PlusX64: true
    },
    signing: { materialPresent: true, manifestSigned: true },
    validation: {
      physicalWindows: true,
      windowsOcr: true,
      installerExecuted: true,
      watchdogSoak: true,
      physicalGpu: true
    },
    ...overrides
  };
}

const reconstructed = gate.evaluate({
  toolCount: 62,
  behavior: allBehavior,
  tests: { node: true, regression: true, crossBuild: false },
  artifact: {},
  signing: { materialPresent: false, manifestSigned: false },
  validation: { physicalWindows: false, physicalGpu: false }
});
assert.strictEqual(reconstructed.reconstructedParity, true);
assert.strictEqual(reconstructed.publishableCandidate, false);
assert.strictEqual(reconstructed.exactV54ClaimAllowed, false);
assert(reconstructed.blockers.includes('verified-windows-artifact-missing'));
assert(reconstructed.blockers.includes('signing-material-or-signed-manifest-missing'));
assert(reconstructed.blockers.includes('physical-windows-validation-missing'));
assert(reconstructed.blockers.includes('windows-ocr-validation-missing'));
assert(reconstructed.blockers.includes('installer-execution-validation-missing'));
assert(reconstructed.blockers.includes('watchdog-soak-validation-missing'));

for (const [field, blocker] of [
  ['physicalWindows', 'physical-windows-validation-missing'],
  ['windowsOcr', 'windows-ocr-validation-missing'],
  ['installerExecuted', 'installer-execution-validation-missing'],
  ['watchdogSoak', 'watchdog-soak-validation-missing']
]) {
  const input = baseCandidate();
  input.validation = { ...input.validation, [field]: false };
  const result = gate.evaluate(input);
  assert.strictEqual(result.publishableCandidate, false, `${field} must block publishable candidate`);
  assert(result.blockers.includes(blocker), `${field} must emit ${blocker}`);
}

const forgedExact = gate.evaluate({
  ...baseCandidate(),
  exactSource: { v540: CONTRACT.v540SourceSha256 }
});
assert.strictEqual(forgedExact.publishableCandidate, true);
assert.strictEqual(forgedExact.exactV54ClaimAllowed, false, 'source identity alone must not permit exact V5.4 artifact claim');
assert.strictEqual(forgedExact.windowsGradeFinalClaimAllowed, true);
assert.strictEqual(forgedExact.windowsOcrValidated, true);
assert.strictEqual(forgedExact.installerExecutionValidated, true);
assert.strictEqual(forgedExact.watchdogSoakValidated, true);

const exactHistoricalInput = baseCandidate({
  exactSource: { v535: CONTRACT.v535SourceSha256, v540: CONTRACT.v540SourceSha256 },
  artifact: {
    path: 'LLera_V5_4_0_MONOLITH_AURORA_UX_Setup.exe',
    kind: 'windows-x64', bytes: 7855104,
    sha256: CONTRACT.v540InstallerSha256, pe32PlusX64: true
  }
});
exactHistoricalInput.validation = { ...exactHistoricalInput.validation, physicalGpu: false };
const exactHistorical = gate.evaluate(exactHistoricalInput);
assert.strictEqual(exactHistorical.exactHistoricalSource.v535, true);
assert.strictEqual(exactHistorical.exactHistoricalSource.v540, true);
assert.strictEqual(exactHistorical.exactV54ClaimAllowed, true);
assert.strictEqual(exactHistorical.publishableCandidate, true);
assert.strictEqual(exactHistorical.windowsGradeFinalClaimAllowed, false, 'GPU final claim requires physical GPU evidence');
assert.strictEqual(exactHistorical.gateDigest.length, 64);

console.log('release candidate truth gate PASS', {
  reconstructedParity: true,
  exactClaimProtected: true,
  releaseBlockedWithoutPhysicalChannels: true,
  finalClaimRequiresPhysicalGpu: true
});
