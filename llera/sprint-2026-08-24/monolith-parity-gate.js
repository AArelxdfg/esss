#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function walk(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const ent of fs.readdirSync(root, {withFileTypes:true})) {
    const p = path.join(root, ent.name);
    if (ent.isDirectory()) {
      if (!['node_modules','.git','out','dist','build'].includes(ent.name)) out.push(...walk(p));
    } else if (/\.(js|cjs|mjs|json|ts|tsx|md)$/i.test(ent.name)) out.push(p);
  }
  return out;
}

function executableRegistryFiles(files) {
  return files.filter(f => /\.(js|cjs|mjs|ts|tsx)$/i.test(f));
}

function scan(root, contract) {
  const files = walk(root);
  const executableFiles = executableRegistryFiles(files);
  const executableText = executableFiles.map(f => { try { return fs.readFileSync(f,'utf8'); } catch { return ''; } }).join('\n');
  const foundTools = new Set();
  const registryTools = new Set();
  for (const re of [/\bname\s*:\s*[\"'\x60]([a-z][a-z0-9_]{2,63})[\"'\x60]/gi, /[\"']name[\"']\s*:\s*[\"']([a-z][a-z0-9_]{2,63})[\"']/gi]) { let m; while ((m = re.exec(executableText))) registryTools.add(m[1]); }
  const family = {};
  for (const [name, tools] of Object.entries(contract.requiredToolFamilies)) {
    family[name] = {required: tools.length, found: []};
    for (const tool of tools) {
      const re = new RegExp(`(?:["'\\x60]|\\b)${tool.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')}(?:["'\\x60]|\\b)`,'i');
      if (re.test(executableText)) { foundTools.add(tool); family[name].found.push(tool); }
    }
  }
  const markers = {};
  for (const marker of contract.requiredBehaviorMarkers) markers[marker] = new RegExp(marker,'i').test(executableText);
  const digest = crypto.createHash('sha256').update(files.sort().map(f => `${path.relative(root,f)}\0${fs.readFileSync(f)}`).join('\n')).digest('hex');
  const missingFamilies = Object.entries(family).filter(([,v]) => v.found.length < v.required).map(([k]) => k);
  const missingMarkers = Object.entries(markers).filter(([,v]) => !v).map(([k]) => k);
  return {
    root: path.resolve(root), filesScanned: files.length, executableFilesScanned: executableFiles.length, sourceDigest: digest,
    knownContractToolsFound: foundTools.size,
    registryToolNamesFound: registryTools.size,
    historicalMinimumAgentTools: contract.baseline.historicalMinimumAgentTools,
    targetAgentTools: contract.baseline.targetAgentTools,
    family, markers, missingFamilies, missingMarkers,
    historicalMinimumEvidenceSatisfied: registryTools.size >= contract.baseline.historicalMinimumAgentTools,
    targetEvidenceSatisfied: registryTools.size >= contract.baseline.targetAgentTools,
    pass: missingFamilies.length === 0 && missingMarkers.length === 0 && registryTools.size >= contract.baseline.historicalMinimumAgentTools
  };
}

function selfTest(contract) {
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'llera-parity-'));
  const allTools = Object.values(contract.requiredToolFamilies).flat();
  const extras = Array.from({length: Math.max(0, contract.baseline.historicalMinimumAgentTools - allTools.length)}, (_,i) => `restored_tool_${String(i+1).padStart(2,'0')}`);
  const names = [...allTools, ...extras];
  const body = names.map(t => `{ name: '${t}' }`).join('\n') + '\n' + contract.requiredBehaviorMarkers.join(' ');
  fs.writeFileSync(path.join(tmp,'fixture.js'), body);
  const r = scan(tmp, contract);
  if (!r.pass) throw new Error(`self-test failed: ${JSON.stringify(r)}`);

  const decoy = fs.mkdtempSync(path.join(os.tmpdir(),'llera-parity-decoy-'));
  fs.writeFileSync(path.join(decoy,'fixture.js'), allTools.map(t => `{ name: '${t}' }`).join('\n') + '\n' + contract.requiredBehaviorMarkers.join(' '));
  fs.writeFileSync(path.join(decoy,'FAKE-TOOL-REPORT.md'), Array.from({length: contract.baseline.targetAgentTools + 20}, (_,i) => `{ name: 'fake_report_tool_${i}' }`).join('\n'));
  const d = scan(decoy, contract);
  if (d.registryToolNamesFound !== new Set(allTools).size) throw new Error(`decoy markdown polluted registry evidence: ${JSON.stringify(d)}`);
  if (d.historicalMinimumEvidenceSatisfied && new Set(allTools).size < contract.baseline.historicalMinimumAgentTools) throw new Error(`decoy markdown produced false historical-minimum PASS: ${JSON.stringify(d)}`);

  const docsOnly = fs.mkdtempSync(path.join(os.tmpdir(),'llera-parity-docsonly-'));
  fs.writeFileSync(path.join(docsOnly,'fixture.js'), extras.map(t => `{ name: '${t}' }`).join('\n'));
  fs.writeFileSync(path.join(docsOnly,'FAKE-PARITY.md'), allTools.map(t => `{ name: '${t}' }`).join('\n') + '\n' + contract.requiredBehaviorMarkers.join(' '));
  fs.writeFileSync(path.join(docsOnly,'fake-contract.json'), JSON.stringify({tools: allTools, markers: contract.requiredBehaviorMarkers}));
  const x = scan(docsOnly, contract);
  fs.rmSync(tmp,{recursive:true,force:true});
  fs.rmSync(decoy,{recursive:true,force:true});
  fs.rmSync(docsOnly,{recursive:true,force:true});
  if (x.knownContractToolsFound !== 0) throw new Error(`docs/json polluted required tool-family evidence: ${JSON.stringify(x)}`);
  if (Object.values(x.markers).some(Boolean)) throw new Error(`docs/json polluted behavior-marker evidence: ${JSON.stringify(x)}`);
  if (x.pass) throw new Error(`docs/json produced false parity PASS: ${JSON.stringify(x)}`);
  console.log(JSON.stringify({selfTest:'PASS', decoyMarkdownIsolation:'PASS', docsJsonIsolation:'PASS', families:Object.keys(contract.requiredToolFamilies).length, registryTools:contract.baseline.historicalMinimumAgentTools, canonicalTools:allTools.length, markers:contract.requiredBehaviorMarkers.length},null,2));
}

const contractPath = process.argv[2] && process.argv[2] !== '--self-test' ? process.argv[2] : path.join(__dirname,'monolith-parity-contract.json');
const contract = JSON.parse(fs.readFileSync(contractPath,'utf8'));
if (process.argv.includes('--self-test')) selfTest(contract);
else {
  const root = process.argv[3] || process.cwd();
  const report = scan(root, contract);
  console.log(JSON.stringify(report,null,2));
  process.exit(report.pass ? 0 : 2);
}
