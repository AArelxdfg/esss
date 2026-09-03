'use strict';
const assert=require('assert');
const {VerifiedUpdateInstallCoordinator}=require('../src/verified-update-install-coordinator');

(async()=>{
  const digest='a'.repeat(64);
  const payloadDigest='b'.repeat(64);
  const manifest={
    version:'5.4.0-reconstructed.1',
    artifact:{sha256:digest,size:4096}
  };
  let downloads=0;
  let installs=0;
  const installer={
    async install(){ installs++; return {verified:true,version:manifest.version,sha256:digest,current:'LLera.exe'}; }
  };
  const updaterFor=receipt=>({
    verifySignedManifest(){ return receipt; },
    async downloadArtifact(){ downloads++; return {path:'download.bin',sha256:digest}; },
    async stageArtifact(){ return 'staged.bin'; }
  });

  const wrongVersion=new VerifiedUpdateInstallCoordinator({
    updater:updaterFor({verified:true,payloadSha256:payloadDigest,version:'5.4.0-reconstructed.2',artifactSha256:digest,artifactSize:4096}),
    installer
  });
  const versionResult=await wrongVersion.apply({manifest,signatureBase64:'signed'});
  assert.equal(versionResult.ok,false);
  assert.equal(versionResult.blocked,true);
  assert.equal(versionResult.reason,'signed_manifest_receipt_version_mismatch');
  assert.equal(downloads,0,'version-mismatched signed receipt must be rejected before download');
  assert.equal(installs,0,'version-mismatched signed receipt must be rejected before install');

  const wrongSize=new VerifiedUpdateInstallCoordinator({
    updater:updaterFor({verified:true,payloadSha256:payloadDigest,version:manifest.version,artifactSha256:digest,artifactSize:8192}),
    installer
  });
  const sizeResult=await wrongSize.apply({manifest,signatureBase64:'signed'});
  assert.equal(sizeResult.ok,false);
  assert.equal(sizeResult.blocked,true);
  assert.equal(sizeResult.reason,'signed_manifest_receipt_artifact_size_mismatch');
  assert.equal(downloads,0,'size-mismatched signed receipt must be rejected before download');
  assert.equal(installs,0,'size-mismatched signed receipt must be rejected before install');

  console.log('verified update receipt metadata binding PASS');
})().catch(error=>{console.error(error);process.exit(1);});
