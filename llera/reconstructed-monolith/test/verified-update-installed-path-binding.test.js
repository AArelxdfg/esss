'use strict';
const assert=require('assert');
const crypto=require('crypto');
const path=require('path');
const {VerifiedUpdateInstallCoordinator}=require('../src/verified-update-install-coordinator');

(async()=>{
  const artifactSha256=crypto.createHash('sha256').update('payload').digest('hex');
  const payloadSha256=crypto.createHash('sha256').update('manifest').digest('hex');
  const manifest={version:'5.4.0-reconstructed.1',artifact:{sha256:artifactSha256,size:7,url:'https://example.invalid/LLera.exe'}};
  const receipt={verified:true,payloadSha256,artifactSha256};
  const updater={
    verifySignedManifest(){return receipt},
    async downloadArtifact(){return{path:'/tmp/download.bin',sha256:artifactSha256,size:7}},
    async stageArtifact(){return'/tmp/staged.exe'}
  };
  let stableMarks=0;
  const watchdog={async launchProfile(){return{mode:'normal'}},async markStable(){stableMarks+=1}};
  const appDir=path.resolve('/tmp/llera-path-binding/app');
  const canonical=path.join(appDir,'LLera.exe');
  const escaped=path.resolve('/tmp/attacker/LLera.exe');

  const goodInstaller={
    paths:{app:appDir},
    async install(i){return{current:canonical,version:i.version,sha256:i.expectedSha256,verified:true}}
  };
  const good=new VerifiedUpdateInstallCoordinator({updater,installer:goodInstaller,watchdog});
  const ok=await good.apply({manifest,signatureBase64:'signed'});
  assert.strictEqual(ok.ok,true);
  assert.strictEqual(ok.installedPath,canonical);
  assert.strictEqual(stableMarks,1);

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

  console.log('verified update installed path binding PASS',{canonicalPathBound:true,pathDivergenceFailsClosed:true,missingPathFailsClosed:true,watchdogStableAfterCanonicalOnly:true});
})().catch(error=>{console.error(error);process.exit(1)});
