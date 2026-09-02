'use strict';
const assert=require('assert');
const os=require('os');
const path=require('path');
const {VerifiedUpdateInstallCoordinator}=require('../src/verified-update-install-coordinator');

(async()=>{
  const digest='a'.repeat(64);
  const payloadDigest='b'.repeat(64);
  const version='5.4.0-reconstructed.1';
  const root=path.join(os.tmpdir(),'llera-verified-staging-binding');
  const downloads=path.join(root,'downloads');
  const staging=path.join(root,'staging');
  const canonicalDownload=path.join(downloads,`${version}.bin`);
  const canonicalStaged=path.join(staging,version,'LLera-update.bin');
  const manifest={version,artifact:{sha256:digest}};
  let installCalls=0;
  const installer={
    paths:{app:path.join(root,'app')},
    async install({payloadPath}){
      installCalls++;
      assert.equal(path.resolve(payloadPath),path.resolve(canonicalStaged));
      return {verified:true,version,sha256:digest,current:path.join(this.paths.app,'LLera.exe')};
    }
  };
  const makeUpdater=stagedPath=>({
    paths:{downloads,staging},
    verifySignedManifest(){return {verified:true,payloadSha256:payloadDigest,artifactSha256:digest};},
    async downloadArtifact(){return {path:canonicalDownload,sha256:digest};},
    async stageArtifact(){return stagedPath;}
  });

  const forgedStaged=path.join(root,'external','LLera-update.bin');
  const rejected=new VerifiedUpdateInstallCoordinator({updater:makeUpdater(forgedStaged),installer});
  await assert.rejects(()=>rejected.apply({manifest,signatureBase64:'signed'}),/canonical verified staging target/);
  assert.equal(installCalls,0,'non-canonical staged artifact must be rejected before install');

  const accepted=new VerifiedUpdateInstallCoordinator({updater:makeUpdater(canonicalStaged),installer});
  const result=await accepted.apply({manifest,signatureBase64:'signed'});
  assert.equal(result.ok,true);
  assert.equal(installCalls,1);

  console.log('verified update staged path binding PASS');
})().catch(error=>{console.error(error);process.exit(1);});
