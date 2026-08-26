'use strict';

const assert = require('assert');
const { CONTRACT, ReleaseCandidateGate } = require('../src/release-candidate-gate');

const allBehavior = Object.fromEntries(CONTRACT.requiredBehaviorGates.map(k => [k, true]));
const gate = new ReleaseCandidateGate();

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

const forgedExact = gate.evaluate({
  toolCount: 62,
  behavior: allBehavior,
  exactSource: { v540: CONTRACT.v540SourceSha256 },
  tests: { node: true, regression: true, crossBuild: true },
  artifact: {
    path: 'LLera_V5_4_0_MONOLITH_AURORA_UX_Setup.exe',
    kind: 'windows-x64', bytes: 7855104,
    sha256: 'f'.repeat(64), pe32PlusX64: true
  },
  signing: { materialPresent: true, manifestSigned: true },
  validation: { physicalWindows: true, physicalGpu: true }
});
assert.strictEqual(forgedExact.publishableCandidate, true);
assert.strictEqual(forgedExact.exactV54ClaimAllowed, false, 'source identity alone must not permit exact V5.4 artifact claim');
assert.strictEqual(forgedExact.windowsGradeFinalClaimAllowed, true);

const exactHistorical = gate.evaluate({
  toolCount: 62,
  behavior: allBehavior,
  exactSource: { v535: CONTRACT.v535SourceSha256, v540: CONTRACT.v540SourceSha256 },
  tests: { node: true, regression: true, crossBuild: true },
  artifact: {
    path: 'LLera_V5_4_0_MONOLITH_AURORA_UX_Setup.exe',
    kind: 'windows-x64', bytes: 7855104,
    sha256: CONTRACT.v540InstallerSha256, pe32PlusX64: true
  },
  signing: { materialPresent: true, manifestSigned: true },
  validation: { physicalWindows: true, physicalGpu: false }
});
assert.strictEqual(exactHistorical.exactHistoricalSource.v535, true);
assert.strictEqual(exactHistorical.exactHistoricalSource.v540, true);
assert.strictEqual(exactHistorical.exactV54ClaimAllowed, true);
assert.strictEqual(exactHistorical.publishableCandidate, true);
assert.strictEqual(exactHistorical.windowsGradeFinalClaimAllowed, false, 'GPU final claim requires physical GPU evidence');
assert.strictEqual(exactHistorical.gateDigest.length, 64);

console.log('release candidate truth gate PASS', {
  reconstructedParity: true,
  exactClaimProtected: true,
  releaseBlockedWithoutEvidence: true,
  finalClaimRequiresPhysicalGpu: true
});
