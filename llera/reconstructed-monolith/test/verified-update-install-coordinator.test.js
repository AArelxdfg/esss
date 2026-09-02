'use strict';
const assert=require('assert'); const crypto=require('crypto'); const {VerifiedUpdateInstallCoordinator}=require('../src/verified-update-install-coordinator');
(async()=>{
 const artifactSha256=crypto.createHash('sha256').update('payload').digest('hex'); const payloadManifestSha256=crypto.createHash('sha256').update('manifest').digest('hex'); const calls=[];
 const verificationReceipt=Object.freeze({verified:true,receiptId:'receipt-1',payloadSha256:payloadManifestSha256,version:'5.4.0-reconstructed.1',artifactSha256,artifactSize:7,artifactUrl:'https://example.invalid/LLera.exe'});
 const updater={
  verifySignedManifest(m,s){calls.push(['verify',m.version,s]);return verificationReceipt},
  async downloadArtifact(m,{resume,verificationReceipt:receipt}){assert.strictEqual(receipt,verificationReceipt);calls.push(['download',m.version,resume,receipt.receiptId]);return{path:'/tmp/download.bin',sha256:artifactSha256,size:7}},
  async stageArtifact(m,p,{verificationReceipt:receipt}){assert.strictEqual(receipt,verificationReceipt);calls.push(['stage',m.version,p,receipt.receiptId]);return'/tmp/staged.exe'}
 };
 const installer={async install(i){calls.push(['install',i.version,i.payloadPath,i.expectedSha256]);return{current:'C:\\LLera\\app\\LLera.exe',version:i.version,sha256:i.expectedSha256,verified:true}}};
 let safeMode=false, stableMarks=0; const watchdog={async launchProfile(){return safeMode?{mode:'safe'}:{mode:'normal'}},async markStable(){stableMarks+=1}};
 const c=new VerifiedUpdateInstallCoordinator({updater,installer,watchdog,now:()=> '2026-08-27T11:37:45+03:00'});
 const manifest={version:'5.4.0-reconstructed.1',artifact:{sha256:artifactSha256,size:7,url:'https://example.invalid/LLera.exe'}};
 const ok=await c.apply({manifest,signatureBase64:'signed-manifest',resume:true,selfTestTimeoutMs:9000});
 assert.strictEqual(ok.ok,true); assert.strictEqual(ok.verified,true); assert.strictEqual(ok.artifactSha256,artifactSha256); assert.strictEqual(ok.manifestPayloadSha256,payloadManifestSha256); assert.strictEqual(stableMarks,1); assert.deepStrictEqual(calls.map(x=>x[0]),['verify','download','stage','install']);
 safeMode=true; const before=calls.length; const blocked=await c.apply({manifest,signatureBase64:'signed-manifest'}); assert.strictEqual(blocked.blocked,true); assert.strictEqual(blocked.reason,'watchdog_safe_mode'); assert.strictEqual(blocked.manifestPayloadSha256,payloadManifestSha256); assert.strictEqual(calls.length,before+1);
 safeMode=false; const failing=new VerifiedUpdateInstallCoordinator({updater,installer:{async install(){throw new Error('installed-app self-test failed; rollback completed')}},watchdog}); const rb=await failing.apply({manifest,signatureBase64:'signed-manifest'}); assert.strictEqual(rb.ok,false); assert.strictEqual(rb.rolledBack,true); assert.strictEqual(rb.manifestPayloadSha256,payloadManifestSha256);
 let digestBlocked=false; const bad=new VerifiedUpdateInstallCoordinator({updater:{...updater,async downloadArtifact(m,{verificationReceipt:receipt}){assert.strictEqual(receipt,verificationReceipt);return{path:'/tmp/bad.bin',sha256:'0'.repeat(64),size:7}}},installer,watchdog}); try{await bad.apply({manifest,signatureBase64:'signed-manifest'})}catch(e){digestBlocked=/digest diverges/.test(e.message)} assert.strictEqual(digestBlocked,true);
 const malformed=new VerifiedUpdateInstallCoordinator({updater:{...updater,verifySignedManifest(){return{verified:true}}},installer,watchdog}); const malformedResult=await malformed.apply({manifest,signatureBase64:'signed-manifest'}); assert.strictEqual(malformedResult.ok,false); assert.strictEqual(malformedResult.blocked,true); assert.strictEqual(malformedResult.reason,'signed_manifest_receipt_invalid');
 console.log('verified update/install bridge PASS',{signedManifestGate:true,verificationReceiptForwarded:true,digestContinuity:true,windowsSelfTestGate:true,rollbackSurfaced:true,watchdogSafeModeGate:true,malformedReceiptFailsClosed:true});
})().catch(e=>{console.error(e);process.exit(1)});
