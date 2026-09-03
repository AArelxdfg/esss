'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const fsp=fs.promises;
const os=require('node:os');
const path=require('node:path');
const {Readable}=require('node:stream');
const {SignedUpdateLifecycle,stableStringify}=require('../src/signed-update-lifecycle');

(async()=>{
  const tmp=await fsp.mkdtemp(path.join(os.tmpdir(),'llera-update-provenance-'));
  try {
    const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
    const bytes=Buffer.from('LLera MONOLITH OMEGA signed lifecycle provenance');
    const manifest={
      product:'LLera MONOLITH OMEGA',
      version:'5.4.0-reconstructed.3',
      artifact:{
        url:'https://updates.invalid/llera.bin',
        size:bytes.length,
        sha256:crypto.createHash('sha256').update(bytes).digest('hex')
      }
    };
    const signature=crypto.sign(null,Buffer.from(stableStringify(manifest)),privateKey).toString('base64');
    let fetchCalls=0;
    const fetchImpl=async()=>{
      fetchCalls++;
      return {ok:true,status:200,headers:{get:()=>null},body:Readable.from([bytes])};
    };
    const lifecycle=new SignedUpdateLifecycle({rootDir:path.join(tmp,'managed'),publicKey,fetchImpl});
    const receipt=lifecycle.verifySignedManifest(manifest,signature);
    const downloaded=await lifecycle.downloadArtifact(manifest,{verificationReceipt:receipt});
    assert.equal(downloaded.sha256,manifest.artifact.sha256);
    const staged=await lifecycle.stageArtifact(manifest,downloaded.path,{verificationReceipt:receipt});
    assert.equal(await fsp.readFile(staged,'utf8'),bytes.toString('utf8'));

    const external=path.join(tmp,'external-same-bytes.bin');
    await fsp.writeFile(external,bytes);
    await assert.rejects(
      lifecycle.stageArtifact(manifest,external,{verificationReceipt:receipt}),
      /staging downloaded path binding mismatch/,
      'direct lifecycle calls must not stage same-hash bytes from outside the canonical downloads path'
    );

    await fsp.rm(downloaded.path,{force:true});
    let downloadSymlinkCreated=true;
    try { await fsp.symlink(external,downloaded.path,'file'); }
    catch(error) {
      if (error && ['EPERM','EACCES','ENOTSUP'].includes(error.code)) downloadSymlinkCreated=false;
      else throw error;
    }
    if (downloadSymlinkCreated) {
      await assert.rejects(
        lifecycle.stageArtifact(manifest,downloaded.path,{verificationReceipt:receipt}),
        /staging downloaded artifact must be a regular bound file/,
        'canonical path aliases through symlinks must not satisfy staging provenance'
      );
      await fsp.rm(downloaded.path,{force:true});
    }

    const partPath=path.join(lifecycle.paths.downloads,`${manifest.version}.bin.part`);
    const outsideVictim=path.join(tmp,'outside-victim.bin');
    const victimBytes=Buffer.from('OUTSIDE MUST REMAIN UNCHANGED');
    await fsp.writeFile(outsideVictim,victimBytes);
    let partSymlinkCreated=true;
    try { await fsp.symlink(outsideVictim,partPath,'file'); }
    catch(error) {
      if (error && ['EPERM','EACCES','ENOTSUP'].includes(error.code)) partSymlinkCreated=false;
      else throw error;
    }
    if (partSymlinkCreated) {
      const callsBefore=fetchCalls;
      await assert.rejects(
        lifecycle.downloadArtifact(manifest,{resume:true,verificationReceipt:receipt}),
        /download partial artifact must be a regular bound file/,
        'resumable partial files must reject symlink substitution before network/write activity'
      );
      assert.equal(fetchCalls,callsBefore,'symlinked partial rejection must happen before fetching');
      assert.deepEqual(await fsp.readFile(outsideVictim),victimBytes,'external symlink target must remain byte-for-byte unchanged');
    }

    console.log(`signed updater lifecycle path provenance PASS${downloadSymlinkCreated&&partSymlinkCreated?'':' (one or more symlink cases skipped: host permission)'}`);
  } finally {
    await fsp.rm(tmp,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exit(1)});
