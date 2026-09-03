'use strict';
const assert=require('assert');
const crypto=require('crypto');
const path=require('path');
const {VerifiedUpdateInstallCoordinator}=require('../src/verified-update-install-coordinator');
(async()=>{
 const artifactSha256=crypto.createHash('sha256').update('payload').digest('hex');
 const payloadSha256=crypto.createHash('sha256').update('manifest').digest('hex');
 const version='5.4.0-reconstructed.1';
 const artifactUrl='https://updates.example.invalid/LLera.exe';
 const downloads=path.resolve('/tmp/llera-update-downloads');
 const staging=path.resolve('/tmp/llera-update-staging');
 const manifest={version,artifact:{sha256:artifactSha256,size:7,url:artifactUrl}};
 const makeReceipt=(overrides={})=>Object.freeze({verified:true,receiptId:'r1',payloadSha256,version,artifactSha256,artifactSize:7,artifactUrl,...overrides});
 let stageCalls=0, installCalls=0;
 const makeUpdater=(receipt,downloadOverrides={})=>({
   paths:{downloads,staging},
   verifySignedManifest(){return receipt},
   async downloadArtifact(){return {path:path.join(downloads,`${version}.bin`),sha256:artifactSha256,size:7,...downloadOverrides}},
   async stageArtifact(){stageCalls+=1;return path.join(staging,version,'LLera-update.bin')}
 });
 const installer={paths:{app:path.resolve('/tmp/llera-app')},async install({expectedSha256,version:v}){installCalls+=1;return{verified:true,sha256:expectedSha256,version:v,current:path.resolve('/tmp/llera-app/LLera.exe')}}};
 const run=async(receipt,downloadOverrides={})=>new VerifiedUpdateInstallCoordinator({updater:makeUpdater(receipt,downloadOverrides),installer}).apply({manifest,signatureBase64:'signed'});
 let r=await run(makeReceipt({artifactSize:8})); assert.strictEqual(r.reason,'signed_manifest_receipt_artifact_size_mismatch'); assert.strictEqual(stageCalls,0); assert.strictEqual(installCalls,0);
 r=await run(makeReceipt({artifactUrl:'https://updates.example.invalid/Other.exe'})); assert.strictEqual(r.reason,'signed_manifest_receipt_artifact_url_mismatch'); assert.strictEqual(stageCalls,0); assert.strictEqual(installCalls,0);
 let sizeRejected=false; try{await run(makeReceipt(),{size:8})}catch(e){sizeRejected=/size diverges/.test(e.message)} assert.strictEqual(sizeRejected,true); assert.strictEqual(stageCalls,0); assert.strictEqual(installCalls,0);
 r=await run(makeReceipt({artifactUrl:'https://updates.example.invalid:443/LLera.exe'})); assert.strictEqual(r.ok,true); assert.strictEqual(stageCalls,1); assert.strictEqual(installCalls,1);
 console.log('verified update artifact metadata binding PASS',{receiptSizeBinding:true,receiptUrlBinding:true,downloadSizeBinding:true,canonicalHttpsUrl:true});
})().catch(e=>{console.error(e);process.exit(1)});
