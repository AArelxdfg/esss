'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { SignedUpdateLifecycle, stableStringify } = require('../src/signed-update-lifecycle');

(async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'llera-updater-verification-binding-'));
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
  const artifactBytes=Buffer.from('signed-update-verification-binding-payload');
  let fetchCalls=0;
  const fetchImpl=async(url)=>{
    fetchCalls+=1;
    return {ok:true,status:200,url,headers:{get(){return null;}},body:Readable.from([artifactBytes])};
  };
  const lifecycle=new SignedUpdateLifecycle({rootDir:tmp,publicKey,fetchImpl});
  await lifecycle.init();

  const manifest={
    version:'5.4-verification-binding',
    artifact:{
      url:'https://updates.invalid/LLera.bin',
      size:artifactBytes.length,
      sha256:crypto.createHash('sha256').update(artifactBytes).digest('hex')
    }
  };
  const stagedSeed=path.join(tmp,'candidate.bin');
  await fs.writeFile(stagedSeed,artifactBytes);

  await assert.rejects(()=>lifecycle.downloadArtifact(manifest,{resume:false}),/signature-verified before update lifecycle use/);
  await assert.rejects(()=>lifecycle.stageArtifact(manifest,stagedSeed),/signature-verified before update lifecycle use/);
  await assert.rejects(()=>lifecycle.activateStaged(manifest,stagedSeed),/signature-verified before update lifecycle use/);
  assert.strictEqual(fetchCalls,0,'unverified download must fail before network access');

  const signatureBase64=crypto.sign(null,Buffer.from(stableStringify(manifest)),privateKey).toString('base64');
  const receipt=lifecycle.verifySignedManifest(manifest,signatureBase64);
  assert.strictEqual(receipt.verified,true);
  assert.match(receipt.receiptId,/./);

  const reordered={
    artifact:{sha256:manifest.artifact.sha256,url:manifest.artifact.url,size:manifest.artifact.size},
    version:manifest.version
  };
  const downloaded=await lifecycle.downloadArtifact(reordered,{resume:false,verificationReceipt:receipt});
  assert.strictEqual(downloaded.sha256,manifest.artifact.sha256);
  assert.strictEqual(fetchCalls,1);

  const staged=await lifecycle.stageArtifact(manifest,downloaded.path);
  assert.ok(staged.endsWith('LLera-update.bin'));

  const forged={...receipt,receiptId:'forged-receipt-id'};
  await assert.rejects(()=>lifecycle.stageArtifact(reordered,downloaded.path,{verificationReceipt:forged}),/verification receipt mismatch/);

  const mutated={...manifest,version:'5.4-verification-binding-mutated'};
  await assert.rejects(()=>lifecycle.stageArtifact(mutated,downloaded.path,{verificationReceipt:receipt}),/verification receipt mismatch/);
  await assert.rejects(()=>lifecycle.stageArtifact(mutated,downloaded.path),/signature-verified before update lifecycle use/);

  const activated=await lifecycle.activateStaged(reordered,staged,{verificationReceipt:receipt});
  assert.ok(activated.currentFile.endsWith('LLera.bin'));
  const journal=await lifecycle.readJournal();
  assert.strictEqual(journal.manifestPayloadSha256,receipt.payloadSha256);

  console.log('MONOLITH signed updater verification binding PASS',{
    unverifiedLifecycleUseRejected:true,
    unverifiedDownloadBlocksBeforeNetwork:true,
    verifiedReceiptAllowsCanonicalEquivalentManifest:true,
    verifiedObjectIdentityPathAllowed:true,
    forgedReceiptRejected:true,
    mutatedManifestRejected:true,
    journalBoundToVerifiedManifestSha256:true
  });
})().catch(error=>{console.error(error);process.exit(1);});
