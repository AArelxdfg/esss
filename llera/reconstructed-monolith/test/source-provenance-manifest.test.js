'use strict';
const assert = require('assert');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { buildSourceProvenance, verifySourceProvenance, digestObject } = require('../src/source-provenance-manifest');

function reseal(manifest) {
  const copy = JSON.parse(JSON.stringify(manifest));
  copy.contentRoot = digestObject(copy.files.map(x => [x.path, x.bytes, x.sha256]));
  const { manifestSha256, ...unsigned } = copy;
  copy.manifestSha256 = digestObject(unsigned);
  return copy;
}

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

  const traversal = JSON.parse(JSON.stringify(first));
  traversal.files[0].path = '../outside.js';
  assert.deepStrictEqual(verifySourceProvenance(reseal(traversal)), {ok:false,reason:'invalid-file-path'});

  const absolute = JSON.parse(JSON.stringify(first));
  absolute.files[0].path = '/tmp/outside.js';
  assert.deepStrictEqual(verifySourceProvenance(reseal(absolute)), {ok:false,reason:'invalid-file-path'});

  const duplicate = JSON.parse(JSON.stringify(first));
  duplicate.files[1].path = duplicate.files[0].path;
  assert.deepStrictEqual(verifySourceProvenance(reseal(duplicate)), {ok:false,reason:'duplicate-file-path'});

  const badSha = JSON.parse(JSON.stringify(first));
  badSha.files[0].sha256 = '0'.repeat(63);
  assert.deepStrictEqual(verifySourceProvenance(reseal(badSha)), {ok:false,reason:'invalid-file-sha256'});

  const negativeBytes = JSON.parse(JSON.stringify(first));
  negativeBytes.files[0].bytes = -1;
  assert.deepStrictEqual(verifySourceProvenance(reseal(negativeBytes)), {ok:false,reason:'invalid-file-bytes'});

  const wrongCount = JSON.parse(JSON.stringify(first));
  wrongCount.fileCount += 1;
  assert.deepStrictEqual(verifySourceProvenance(reseal(wrongCount)), {ok:false,reason:'file-count-mismatch'});

  const wrongTotal = JSON.parse(JSON.stringify(first));
  wrongTotal.totalBytes += 1;
  assert.deepStrictEqual(verifySourceProvenance(reseal(wrongTotal)), {ok:false,reason:'total-bytes-mismatch'});

  await fs.writeFile(path.join(root,'src','a.js'),'alpha changed\n');
  const changed=await buildSourceProvenance({rootDir:root,createdAt:null});
  assert.notStrictEqual(changed.contentRoot,first.contentRoot);
  console.log('source provenance manifest PASS',{deterministic:true,ignoredBuildNoise:true,tamperDetected:true,historicalClaimForbidden:true,canonicalPaths:true,duplicatePathsRejected:true,semanticCountsBound:true});
})().catch(err=>{console.error(err);process.exit(1);});
