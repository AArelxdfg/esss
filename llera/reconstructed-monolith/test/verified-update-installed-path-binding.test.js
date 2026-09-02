'use strict';
const assert=require('assert');
const crypto=require('crypto');
const path=require('path');
const {VerifiedUpdateInstallCoordinator,isCanonicalVersion}=require('../src/verified-update-install-coordinator');

(async()=>{
  const artifactSha256=crypto.createHash('sha256').update('payload').digest('hex');
  const payloadSha256=crypto.createHash('sha256').update('manifest').digest('hex');
  const manifest={version:'5.4.0-reconstructed.1',artifact:{sha256:artifactSha256,size:7,url:'https://example.invalid/LLera.exe'}};
  const receipt={verified:true,payloadSha256,artifactSha256};
  let downloads=0;
  const updater={
    verifySignedManifest(){return receipt},
    async downloadArtifact(){downloads+=1;return{path:'/tmp/download.bin',sha256:artifactSha256,size:7}},
    async stageArtifact(){return'/tmp/staged.exe'}
  };
  let stableMarks=0;
  const watchdog={async launchProfile(){return{mode:'normal'}},async markStable(){stableMarks+=1}};
  const appDir=path.resolve('/tmp/llera-path-binding/app');
  const canonical=path.join(appDir,'LLera.exe');
  const escaped=path.resolve('/tmp/attacker/LLera.exe');
  const badSignedVersions=['', '../5.4.0', '5.4.0/../../evil', '5.4', 'v5.4.0', '5.4.0\nnext', '5.4.0 beta', '5.4.0-', ' 5.4.0', '5.4.0 ', '\t5.4.0', '5.4.0\n'];

  assert.strictEqual(isCanonicalVersion('5.4.0-reconstructed.1'),true);
  assert.strictEqual(isCanonicalVersion('5.4.0+win.x64'),true);
  for (const badVersion of badSignedVersions) {
    assert.strictEqual(isCanonicalVersion(badVersion),false,`must reject non-canonical version ${JSON.stringify(badVersion)}`);
  }

  const goodInstaller={
    paths:{app:appDir},
    async install(i){return{current:canonical,version:i.version,sha256:i.expectedSha256,verified:true}}
  };
  const good=new VerifiedUpdateInstallCoordinator({updater,installer:goodInstaller,watchdog});
  const ok=await good.apply({manifest,signatureBase64:'signed'});
  assert.strictEqual(ok.ok,true);
  assert.strictEqual(ok.installedPath,canonical);
  assert.strictEqual(stableMarks,1);
  assert.strictEqual(downloads,1);

  const badInstaller={
    paths:{app:appDir},
    async install(i){return{current:escaped,version:i.version,sha256:i.expectedSha256,verified:true}}
  };
  const bad=new VerifiedUpdateInstallCoordinator({updater,installer:badInstaller,watchdog});
  let rejected=false;
  try { await bad.apply({manifest,signatureBase64:'signed'}); }
  catch(error) { rejected=/canonical install target/.test(String(error&&error.message||error)); }
  assert.strictEqual(rejected,true);
  assert.strictEqual(stableMarks,1,'watchdog must not mark a path-divergent install stable');

  const missingInstaller={
    paths:{app:appDir},
    async install(i){return{current:'',version:i.version,sha256:i.expectedSha256,verified:true}}
  };
  const missing=new VerifiedUpdateInstallCoordinator({updater,installer:missingInstaller,watchdog});
  let missingRejected=false;
  try { await missing.apply({manifest,signatureBase64:'signed'}); }
  catch(error) { missingRejected=/no installed artifact path/.test(String(error&&error.message||error)); }
  assert.strictEqual(missingRejected,true);
  assert.strictEqual(stableMarks,1);

  const wrongVersionInstaller={
    paths:{app:appDir},
    async install(i){return{current:canonical,version:'5.4.0-reconstructed.0',sha256:i.expectedSha256,verified:true}}
  };
  const wrongVersion=new VerifiedUpdateInstallCoordinator({updater,installer:wrongVersionInstaller,watchdog});
  let versionRejected=false;
  try { await wrongVersion.apply({manifest,signatureBase64:'signed'}); }
  catch(error) { versionRejected=/version diverges from signed manifest/.test(String(error&&error.message||error)); }
  assert.strictEqual(versionRejected,true);
  assert.strictEqual(stableMarks,1,'watchdog must not mark a version-divergent install stable');

  const whitespaceVersionInstaller={
    paths:{app:appDir},
    async install(i){return{current:canonical,version:` ${i.version}`,sha256:i.expectedSha256,verified:true}}
  };
  let whitespaceInstalledVersionRejected=false;
  try { await new VerifiedUpdateInstallCoordinator({updater,installer:whitespaceVersionInstaller,watchdog}).apply({manifest,signatureBase64:'signed'}); }
  catch(error) { whitespaceInstalledVersionRejected=/version diverges from signed manifest/.test(String(error&&error.message||error)); }
  assert.strictEqual(whitespaceInstalledVersionRejected,true,'installed version identity must be byte-for-byte canonical');
  assert.strictEqual(stableMarks,1,'watchdog must not mark a whitespace-mutated installed version stable');

  for (const badVersion of badSignedVersions) {
    const beforeDownloads=downloads;
    const invalidVersionResult=await new VerifiedUpdateInstallCoordinator({updater,installer:goodInstaller,watchdog}).apply({manifest:{...manifest,version:badVersion},signatureBase64:'signed'});
    assert.strictEqual(invalidVersionResult.ok,false);
    assert.strictEqual(invalidVersionResult.blocked,true);
    assert.strictEqual(invalidVersionResult.reason,'signed_manifest_version_invalid');
    assert.strictEqual(downloads,beforeDownloads,'invalid signed version must fail before download I/O');
    assert.strictEqual(stableMarks,1);
  }

  console.log('verified update installed identity binding PASS',{canonicalPathBound:true,pathDivergenceFailsClosed:true,missingPathFailsClosed:true,versionDivergenceFailsClosed:true,whitespaceVersionMutationFailsClosed:true,nonCanonicalSignedVersionFailsClosed:true,invalidVersionRejectedBeforeDownload:true,watchdogStableAfterCanonicalIdentityOnly:true});
})().catch(error=>{console.error(error);process.exit(1)});
