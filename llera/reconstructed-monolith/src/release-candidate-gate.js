'use strict';

const crypto = require('crypto');

const CONTRACT = Object.freeze({
  v535SourceSha256: '06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097',
  v540SourceSha256: 'b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471',
  v535InstallerSha256: '1852b9c116fca9c4107e814b556956028d4732f4f04a00f606908d47667b9d2e',
  v540InstallerSha256: '0304fc6586a0002b2c327ee113dfa9348a220e83668ebbb5aa3c1ef405fd969a',
  requiredToolCount: 62,
  requiredBehaviorGates: Object.freeze([
    'runtimeLifecycle', 'persistentMissions', 'toolSurface', 'verificationDebt',
    'structuredEvidence', 'dualVerifier', 'outcomeMemory', 'skillEvolution',
    'failureDoctrine', 'integritySentinel', 'visionOcr', 'hostguard',
    'signedUpdater', 'auroraUi', 'windowsPackaging', 'soakRecovery'
  ])
});

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = stable(value[key]);
      return out;
    }, {});
  }
  return value;
}

function digestObject(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

class ReleaseCandidateGate {
  evaluate(input = {}) {
    const behavior = input.behavior || {};
    const missingBehavior = CONTRACT.requiredBehaviorGates.filter(name => behavior[name] !== true);
    const toolCount = Number(input.toolCount || 0);
    const reconstructedParity = missingBehavior.length === 0 && toolCount >= CONTRACT.requiredToolCount;

    const exactV535 = Boolean(input.exactSource && input.exactSource.v535 === CONTRACT.v535SourceSha256);
    const exactV540 = Boolean(input.exactSource && input.exactSource.v540 === CONTRACT.v540SourceSha256);

    const artifact = input.artifact || {};
    const artifactEvidenceValid = Boolean(
      artifact.path &&
      artifact.kind === 'windows-x64' &&
      Number(artifact.bytes) > 0 &&
      isSha256(artifact.sha256) &&
      artifact.pe32PlusX64 === true
    );

    const testEvidenceValid = Boolean(
      input.tests &&
      input.tests.node === true &&
      input.tests.regression === true &&
      input.tests.crossBuild === true
    );

    const signingReady = Boolean(input.signing && input.signing.materialPresent === true && input.signing.manifestSigned === true);
    const validation = input.validation || {};
    const physicalWindowsValidated = validation.physicalWindows === true;
    const physicalGpuValidated = validation.physicalGpu === true;
    const physicalOcrValidated = validation.physicalOcr === true;
    const installerExecutionValidated = validation.installerExecution === true;
    const watchdogSoakValidated = validation.watchdogSoak === true;

    const blockers = [];
    if (!reconstructedParity) blockers.push('behavior-parity-incomplete');
    if (!artifactEvidenceValid) blockers.push('verified-windows-artifact-missing');
    if (!testEvidenceValid) blockers.push('required-tests-or-crossbuild-missing');
    if (!signingReady) blockers.push('signing-material-or-signed-manifest-missing');
    if (!physicalWindowsValidated) blockers.push('physical-windows-validation-missing');
    if (!physicalOcrValidated) blockers.push('physical-ocr-validation-missing');
    if (!installerExecutionValidated) blockers.push('physical-installer-execution-validation-missing');
    if (!watchdogSoakValidated) blockers.push('physical-watchdog-soak-validation-missing');

    const publishableCandidate = blockers.length === 0;
    const exactV54ClaimAllowed = exactV540 && artifact.sha256 === CONTRACT.v540InstallerSha256;
    const windowsGradeFinalClaimAllowed = publishableCandidate && physicalGpuValidated;

    const result = {
      schema: 2,
      reconstructedParity,
      exactHistoricalSource: { v535: exactV535, v540: exactV540 },
      exactV54ClaimAllowed,
      publishableCandidate,
      windowsGradeFinalClaimAllowed,
      missingBehavior,
      toolCount,
      artifactEvidenceValid,
      testEvidenceValid,
      signingReady,
      physicalWindowsValidated,
      physicalGpuValidated,
      physicalOcrValidated,
      installerExecutionValidated,
      watchdogSoakValidated,
      blockers
    };
    return { ...result, gateDigest: digestObject(result) };
  }
}

module.exports = { CONTRACT, ReleaseCandidateGate, digestObject };
