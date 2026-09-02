'use strict';
const assert=require('assert');
const {VerifiedUpdateInstallCoordinator}=require('../src/verified-update-install-coordinator');
const sha='a'.repeat(64);
function make(profile){
 const calls={download:0,stage:0,install:0,stable:0};
 const updater={verifySignedManifest(){return {verified:true,payloadSha256:'b'.repeat(64)};},async downloadArtifact(){calls.download++;return {path:'download.bin',sha256:sha};},async stageArtifact(){calls.stage++;return 'staged.bin';}};
 const installer={async install(){calls.install++;return {verified:true,sha256:sha,current:'current/LLera.bin'};}};
 const watchdog={async launchProfile(){return profile;},async markStable(){calls.stable++;}};
 return {coordinator:new VerifiedUpdateInstallCoordinator({updater,installer,watchdog}),calls,manifest:{version:'watchdog-boundary',artifact:{sha256:sha}}};
}
(async()=>{
 for(const profile of [null,{}, {mode:'unknown'},{mode:'degraded'}]){
   const {coordinator,calls,manifest}=make(profile); const r=await coordinator.apply({manifest,signatureBase64:'signed'});
   assert.equal(r.blocked,true); assert.equal(r.reason,'watchdog_profile_invalid'); assert.deepEqual(calls,{download:0,stage:0,install:0,stable:0});
 }
 {
   const {coordinator,calls,manifest}=make({mode:'safe'}); const r=await coordinator.apply({manifest,signatureBase64:'signed'});
   assert.equal(r.blocked,true); assert.equal(r.reason,'watchdog_safe_mode'); assert.equal(calls.install,0);
 }
 {
   const {coordinator,calls,manifest}=make({mode:'normal'}); const r=await coordinator.apply({manifest,signatureBase64:'signed'});
   assert.equal(r.ok,true); assert.deepEqual(calls,{download:1,stage:1,install:1,stable:1});
 }
 console.log('verified update watchdog profile boundary PASS');
})().catch(err=>{console.error(err);process.exit(1);});
