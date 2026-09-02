'use strict';
const assert=require('assert');
const os=require('os');
const path=require('path');
const {VerifiedUpdateInstallCoordinator}=require('../src/verified-update-install-coordinator');

(async()=>{
  const digest='a'.repeat(64);
  const payloadDigest='b'.repeat(64);
  const version='5.4.0-reconstructed.1';
  const downloads=path.join(os.tmpdir(),'llera-verified-download-binding');
  const canonicalDownload=path.join(downloads,`${version}.bin`);
  const manifest={version,artifact:{sha256:digest}};
  let stageCalls=0;
  let installCalls=0;
  const makeUpdater=downloadedPath=>({
    paths:{downloads},
    verifySignedManifest(){return {verified:true,payloadSha256:payloadDigest,artifactSha256:digest};},
    async downloadArtifact(){return {path:downloadedPath,sha256:digest};},
    async stageArtifact(_manifest,downloaded){stageCalls++; assert.equal(path.resolve(downloaded),path.resolve(canonicalDownload)); return path.join(os.tmpdir(),'LLera-update.bin');}
  });
  const installer={
    paths:{app:path.join(os.tmpdir(),'llera-app')},
    async install(){installCalls++; return {verified:true,version,sha256:digest,current:path.join(this.paths.app,'LLera.exe')};}
  };

  const forgedPath=path.join(os.tmpdir(),'external-copy-with-same-digest.bin');
  const rejected=new VerifiedUpdateInstallCoordinator({updater:makeUpdater(forgedPath),installer});
  await assert.rejects(()=>rejected.apply({manifest,signatureBase64:'signed'}),/canonical verified download target/);
  assert.equal(stageCalls,0,'non-canonical verified download must be rejected before staging');
  assert.equal(installCalls,0,'non-canonical verified download must be rejected before install');

  const accepted=new VerifiedUpdateInstallCoordinator({updater:makeUpdater(canonicalDownload),installer});
  const result=await accepted.apply({manifest,signatureBase64:'signed'});
  assert.equal(result.ok,true);
  assert.equal(stageCalls,1);
  assert.equal(installCalls,1);

  console.log('verified update downloaded path binding PASS');
})().catch(error=>{console.error(error);process.exit(1);});
