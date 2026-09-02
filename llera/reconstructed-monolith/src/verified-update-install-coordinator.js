'use strict';
const path=require('path');
function isCanonicalVersion(value){
  const version=String(value||'');
  if (!version || version.length>128 || version!==version.trim()) return false;
  return /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(version);
}
function sameResolvedPath(a,b){
  if (!a || !b) return false;
  const left=path.resolve(String(a));
  const right=path.resolve(String(b));
  return process.platform==='win32'?left.toLowerCase()===right.toLowerCase():left===right;
}
class VerifiedUpdateInstallCoordinator {
  constructor({ updater, installer, watchdog = null, now = () => new Date().toISOString() } = {}) {
    if (!updater || typeof updater.verifySignedManifest !== 'function' || typeof updater.downloadArtifact !== 'function' || typeof updater.stageArtifact !== 'function') throw new Error('updater verify/download/stage lifecycle is required');
    if (!installer || typeof installer.install !== 'function') throw new Error('installer.install is required');
    if (watchdog != null && (typeof watchdog.launchProfile !== 'function' || typeof watchdog.markStable !== 'function')) throw new Error('watchdog launchProfile/markStable is required when provided');
    this.updater=updater; this.installer=installer; this.watchdog=watchdog; this.now=now; this.history=[];
  }
  async apply({ manifest, signatureBase64, resume = true, selfTestTimeoutMs = 5000 } = {}) {
    const verificationReceipt=this.updater.verifySignedManifest(manifest, signatureBase64);
    const receiptPayloadSha256=String(verificationReceipt&&verificationReceipt.payloadSha256||'').trim().toLowerCase();
    if (!verificationReceipt || verificationReceipt.verified !== true || !/^[a-f0-9]{64}$/.test(receiptPayloadSha256)) {
      const result={ok:false,blocked:true,reason:'signed_manifest_receipt_invalid',version:manifest&&manifest.version||null,manifestPayloadSha256:/^[a-f0-9]{64}$/.test(receiptPayloadSha256)?receiptPayloadSha256:null,at:this.now()}; this.history.push(result); return result;
    }
    const expectedVersion=String(manifest&&manifest.version||'');
    if (!isCanonicalVersion(expectedVersion)) {
      const result={ok:false,blocked:true,reason:'signed_manifest_version_invalid',version:null,manifestPayloadSha256:receiptPayloadSha256,at:this.now()}; this.history.push(result); return result;
    }
    const expectedSha256=String(manifest&&manifest.artifact&&manifest.artifact.sha256||'').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
      const result={ok:false,blocked:true,reason:'signed_manifest_artifact_sha256_invalid',version:expectedVersion,manifestPayloadSha256:receiptPayloadSha256,at:this.now()}; this.history.push(result); return result;
    }
    const receiptArtifactSha256=String(verificationReceipt.artifactSha256||'').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(receiptArtifactSha256)) {
      const result={ok:false,blocked:true,reason:'signed_manifest_receipt_artifact_invalid',version:expectedVersion,manifestPayloadSha256:receiptPayloadSha256,artifactSha256:expectedSha256,at:this.now()}; this.history.push(result); return result;
    }
    if (receiptArtifactSha256!==expectedSha256) {
      const result={ok:false,blocked:true,reason:'signed_manifest_receipt_artifact_mismatch',version:expectedVersion,manifestPayloadSha256:receiptPayloadSha256,artifactSha256:expectedSha256,at:this.now()}; this.history.push(result); return result;
    }
    const watchdogProfile=this.watchdog ? await this.watchdog.launchProfile() : {mode:'normal'};
    if (!watchdogProfile || typeof watchdogProfile !== 'object' || watchdogProfile.mode!=='normal') {
      const reason=watchdogProfile&&watchdogProfile.mode==='safe'?'watchdog_safe_mode':'watchdog_profile_invalid';
      const result={ok:false,blocked:true,reason,version:expectedVersion,manifestPayloadSha256:receiptPayloadSha256,at:this.now()}; this.history.push(result); return result;
    }
    const downloaded=await this.updater.downloadArtifact(manifest,{resume,verificationReceipt});
    if (!downloaded || !downloaded.path) throw new Error('updater returned no downloaded artifact path');
    if (String(downloaded.sha256||'').trim().toLowerCase()!==expectedSha256) throw new Error('downloaded artifact digest diverges from signed manifest');
    if (this.updater.paths && this.updater.paths.downloads) {
      const canonicalDownload=path.resolve(this.updater.paths.downloads,`${expectedVersion}.bin`);
      if (!sameResolvedPath(downloaded.path,canonicalDownload)) throw new Error('downloaded artifact path diverges from canonical verified download target');
    }
    const staged=await this.updater.stageArtifact(manifest,downloaded.path,{verificationReceipt});
    if (!staged) throw new Error('updater returned no staged artifact path');
    let installed;
    try {
      installed=await this.installer.install({payloadPath:staged,expectedSha256,version:expectedVersion,selfTestTimeoutMs});
    } catch(error) {
      const result={ok:false,blocked:false,version:expectedVersion,phase:'install-self-test',rolledBack:/rollback completed/i.test(String(error&&error.message||error)),error:String(error&&error.message||error),manifestPayloadSha256:receiptPayloadSha256,artifactSha256:expectedSha256,at:this.now()}; this.history.push(result); return result;
    }
    if (!installed || installed.verified!==true) throw new Error('installer did not return verified install state');
    if (String(installed.version||'')!==expectedVersion) throw new Error('installed artifact version diverges from signed manifest');
    if (String(installed.sha256||'').trim().toLowerCase()!==expectedSha256) throw new Error('installed artifact digest diverges from signed manifest');
    const installedPath=String(installed.current||'').trim();
    if (!installedPath) throw new Error('installer returned no installed artifact path');
    if (this.installer.paths && this.installer.paths.app) {
      const canonicalCurrent=path.resolve(this.installer.paths.app,'LLera.exe');
      if (!sameResolvedPath(installedPath,canonicalCurrent)) throw new Error('installed artifact path diverges from canonical install target');
    }
    if (this.watchdog) await this.watchdog.markStable();
    const result={ok:true,blocked:false,version:expectedVersion,verified:true,manifestPayloadSha256:receiptPayloadSha256,artifactSha256:expectedSha256,installedPath,at:this.now()}; this.history.push(result); return result;
  }
  status(){const latest=this.history.at(-1)||null; return {runs:this.history.length,latest:latest?{...latest}:null};}
}
module.exports={VerifiedUpdateInstallCoordinator,isCanonicalVersion,sameResolvedPath};
