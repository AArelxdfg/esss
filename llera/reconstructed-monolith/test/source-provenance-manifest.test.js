'use strict';
const assert = require('assert');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { buildSourceProvenance, verifySourceProvenance } = require('../src/source-provenance-manifest');
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'llera-prov-'));
  await fs.mkdir(path.join(root,'src'), {recursive:true});
  await fs.mkdir(path.join(root,'node_modules','ignored'), {recursive:true});
  await fs.writeFile(path.join(root,'src','a.js'),'alpha\n');
  await fs.writeFile(path.join(root,'src','b.js'),'beta\n');
  await fs.writeFile(path.join(root,'node_modules','ignored','x.js'),'ignored\n');
  const first = await buildSourceProvenance({rootDir:root,createdAt:null});
  const second = await buildSourceProvenance({rootDir:root,createdAt:null});
  assert.strictEqual(first.fileCount,2);
  assert.strictEqual(first.manifestSha256,second.manifestSha256);
  assert.strictEqual(first.contentRoot,second.contentRoot);
  assert.strictEqual(first.exactHistoricalSource,false);
  assert.strictEqual(verifySourceProvenance(first).ok,true);

  const tampered=JSON.parse(JSON.stringify(first)); tampered.files[0].bytes += 1;
  assert.strictEqual(verifySourceProvenance(tampered).ok,false);
  const falseClaim=JSON.parse(JSON.stringify(first)); falseClaim.exactHistoricalSource=true;
  assert.deepStrictEqual(verifySourceProvenance(falseClaim),{ok:false,reason:'historical-claim-forbidden'});

  const forge = (mutate) => {
    const copy = JSON.parse(JSON.stringify(first));
    mutate(copy);
    return copy;
  };
  assert.strictEqual(verifySourceProvenance(forge(x => { x.files[0].path='../escape.js'; })).reason,'unsafe-file-path');
  assert.strictEqual(verifySourceProvenance(forge(x => { x.files[0].path='C:/escape.js'; })).reason,'invalid-file-path');
  assert.strictEqual(verifySourceProvenance(forge(x => { x.files[1].path=x.files[0].path; })).reason,'duplicate-file-path');
  assert.strictEqual(verifySourceProvenance(forge(x => { x.files.reverse(); })).reason,'noncanonical-file-order');
  assert.strictEqual(verifySourceProvenance(forge(x => { x.files[0].bytes=-1; })).reason,'invalid-file-bytes');
  assert.strictEqual(verifySourceProvenance(forge(x => { x.files[0].sha256='0'.repeat(63); })).reason,'invalid-file-sha256');
  assert.strictEqual(verifySourceProvenance(forge(x => { x.fileCount += 1; })).reason,'file-count-mismatch');
  assert.strictEqual(verifySourceProvenance(forge(x => { x.totalBytes += 1; })).reason,'total-bytes-mismatch');

  await fs.writeFile(path.join(root,'src','a.js'),'alpha changed\n');
  const changed=await buildSourceProvenance({rootDir:root,createdAt:null});
  assert.notStrictEqual(changed.contentRoot,first.contentRoot);
  console.log('source provenance manifest PASS',{deterministic:true,ignoredBuildNoise:true,tamperDetected:true,historicalClaimForbidden:true,pathSafety:true,canonicalOrder:true,metadataBound:true});
})().catch(err=>{console.error(err);process.exit(1);});
