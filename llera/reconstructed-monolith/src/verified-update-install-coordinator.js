'use strict';
class VerifiedUpdateInstallCoordinator {
  constructor({ updater, installer, watchdog = null, now = () => new Date().toISOString() } = {}) {
    if (!updater || typeof updater.verifySignedManifest !== 'function' || typeof updater.downloadArtifact !== 'function' || typeof updater.stageArtifact !== 'function') throw new Error('updater verify/download/stage lifecycle is required');
    if (!installer || typeof installer.install !== 'function') throw new Error('installer.install is required');
    if (watchdog != null && (typeof watchdog.launchProfile !== 'function' || typeof watchdog.markStable !== 'function')) throw new Error('watchdog launchProfile/markStable is required when provided');
    this.updater=updater; this.installer=installer; this.watchdog=watchdog; this.now=now; this.history=[];
  }
  async apply({ manifest, signatureBase64, resume = true, selfTestTimeoutMs = 5000 } = {}) {
    const verifiedManifest=this.updater.verifySignedManifest(manifest, signatureBase64);
    const watchdogProfile=this.watchdog ? await this.watchdog.launchProfile() : {mode:'normal'};
    if (watchdogProfile.mode==='safe') {
      const result={ok:false,blocked:true,reason:'watchdog_safe_mode',version:manifest&&manifest.version||null,at:this.now()}; this.history.push(result); return result;
    }
    const downloaded=await this.updater.downloadArtifact(manifest,{resume});
    if (!downloaded || !downloaded.path) throw new Error('updater returned no downloaded artifact path');
    const staged=await this.updater.stageArtifact(manifest,downloaded.path);
    if (!staged) throw new Error('updater returned no staged artifact path');
    const expectedSha256=String(manifest&&manifest.artifact&&manifest.artifact.sha256||'').toLowerCase();
    if (String(downloaded.sha256||'').toLowerCase()!==expectedSha256) throw new Error('downloaded artifact digest diverges from signed manifest');
    let installed;
    try {
      installed=await this.installer.install({payloadPath:staged,expectedSha256,version:manifest.version,selfTestTimeoutMs});
    } catch(error) {
      const result={ok:false,blocked:false,version:manifest.version,phase:'install-self-test',rolledBack:/rollback completed/i.test(String(error&&error.message||error)),error:String(error&&error.message||error),manifestPayloadSha256:verifiedManifest.payloadSha256||null,artifactSha256:expectedSha256,at:this.now()}; this.history.push(result); return result;
    }
    if (!installed || installed.verified!==true) throw new Error('installer did not return verified install state');
    if (String(installed.sha256||'').toLowerCase()!==expectedSha256) throw new Error('installed artifact digest diverges from signed manifest');
    if (this.watchdog) {
      try {
        await this.watchdog.markStable();
      } catch(error) {
        let rollback=null;
        if (typeof this.installer.rollbackVerifiedInstall==='function') {
          try {
            rollback=await this.installer.rollbackVerifiedInstall({version:manifest.version,expectedSha256,hadCurrent:installed.hadCurrent===true,previousSha256:installed.previousSha256||null});
          } catch(rollbackError) {
            rollback={rolledBack:false,blocked:true,repairRequired:true,reason:'post_install_rollback_failed',error:String(rollbackError&&rollbackError.message||rollbackError)};
          }
        }
        const result={ok:false,blocked:true,version:manifest.version,phase:'watchdog-stability-commit',reason:'watchdog_stability_commit_failed',installedVerified:true,rolledBack:rollback&&rollback.rolledBack===true,rollbackAttempted:rollback!==null,rollbackRepairRequired:rollback&&rollback.repairRequired===true,rollbackReason:rollback&&rollback.reason||null,artifactSha256:expectedSha256,manifestPayloadSha256:verifiedManifest.payloadSha256||null,installedPath:installed.current||null,error:String(error&&error.message||error),at:this.now()};
        this.history.push(result);
        return result;
      }
    }
    const result={ok:true,blocked:false,version:manifest.version,verified:true,manifestPayloadSha256:verifiedManifest.payloadSha256||null,artifactSha256:expectedSha256,installedPath:installed.current||null,at:this.now()}; this.history.push(result); return result;
  }
  status(){const latest=this.history.at(-1)||null; return {runs:this.history.length,latest:latest?{...latest}:null};}
}
module.exports={VerifiedUpdateInstallCoordinator};
