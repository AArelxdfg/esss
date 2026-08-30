#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXEC_EXT = /\.(?:js|cjs|mjs|ts|tsx)$/i;
const TOOL_HINT = /\b(?:description|execute|handler|run|invoke|inputSchema|input_schema|parameters|argsSchema|schema)\b/;
const NAME_RE = /\bname\s*:\s*["'`]([a-z][a-z0-9_]{2,63})["'`]/gi;

function walk(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const ent of fs.readdirSync(root,{withFileTypes:true})) {
    const p = path.join(root,ent.name);
    if (ent.isDirectory()) {
      if (!['node_modules','.git','out','dist','build'].includes(ent.name)) out.push(...walk(p));
    } else if (/\.(js|cjs|mjs|json|ts|tsx|md)$/i.test(ent.name)) out.push(p);
  }
  return out;
}

function executableRegistryFiles(files) {
  return files.filter(f => EXEC_EXT.test(f));
}

function objectWindow(text,index,maxSpan=1200) {
  const start = text.lastIndexOf('{',index);
  const end = text.indexOf('}',index);
  if (start < 0 || end < 0 || end <= start || (end-start) > maxSpan) return '';
  return text.slice(start,end+1);
}

function semanticRegistryEvidence(root, executableFiles) {
  const names = new Set();
  const evidence = [];
  for (const file of executableFiles) {
    let text = '';
    try { text = fs.readFileSync(file,'utf8'); } catch { continue; }
    NAME_RE.lastIndex = 0;
    let m;
    while ((m = NAME_RE.exec(text))) {
      const window = objectWindow(text,m.index);
      if (!TOOL_HINT.test(window)) continue;
      names.add(m[1]);
      evidence.push({name:m[1], file:path.relative(root,file), offset:m.index});
    }
  }
  return {names,evidence};
}

function scan(root, contract) {
  const files = walk(root);
  const executableFiles = executableRegistryFiles(files);
  const executableText = executableFiles.map(f => { try { return fs.readFileSync(f,'utf8'); } catch { return ''; } }).join('\n');
  const registry = semanticRegistryEvidence(root, executableFiles);
  const registryTools = registry.names;
  const foundTools = new Set();
  const family = {};
  for (const [name,tools] of Object.entries(contract.requiredToolFamilies)) {
    family[name] = {required:tools.length,found:[]};
    for (const tool of tools) {
      if (registryTools.has(tool)) {
        foundTools.add(tool);
        family[name].found.push(tool);
      }
    }
  }
  const markers = {};
  for (const marker of contract.requiredBehaviorMarkers) markers[marker] = new RegExp(marker,'i').test(executableText);
  const digest = crypto.createHash('sha256').update(files.sort().map(f => `${path.relative(root,f)}\0${fs.readFileSync(f)}`).join('\n')).digest('hex');
  const missingFamilies = Object.entries(family).filter(([,v]) => v.found.length < v.required).map(([k]) => k);
  const missingMarkers = Object.entries(markers).filter(([,v]) => !v).map(([k]) => k);
  return {
    root:path.resolve(root), filesScanned:files.length, executableFilesScanned:executableFiles.length, sourceDigest:digest,
    knownContractToolsFound:foundTools.size,
    registryToolNamesFound:registryTools.size,
    registryEvidence:registry.evidence,
    historicalMinimumAgentTools:contract.baseline.historicalMinimumAgentTools,
    targetAgentTools:contract.baseline.targetAgentTools,
    family,markers,missingFamilies,missingMarkers,
    historicalMinimumEvidenceSatisfied:registryTools.size >= contract.baseline.historicalMinimumAgentTools,
    targetEvidenceSatisfied:registryTools.size >= contract.baseline.targetAgentTools,
    pass:missingFamilies.length === 0 && missingMarkers.length === 0 && registryTools.size >= contract.baseline.historicalMinimumAgentTools
  };
}

function toolObject(name) {
  return `{ name: '${name}', description: '${name}', execute: async () => true }`;
}

function selfTest(contract) {
  const os = require('os');
  const dirs = [];
  const mk = prefix => { const d = fs.mkdtempSync(path.join(os.tmpdir(),prefix)); dirs.push(d); return d; };
  try {
    const allTools = Object.values(contract.requiredToolFamilies).flat();
    const extras = Array.from({length:Math.max(0,contract.baseline.historicalMinimumAgentTools-allTools.length)},(_,i)=>`restored_tool_${String(i+1).padStart(2,'0')}`);

    const good = mk('llera-parity-good-');
    fs.writeFileSync(path.join(good,'fixture.js'), [...allTools,...extras].map(toolObject).join('\n') + '\n' + contract.requiredBehaviorMarkers.join(' '));
    const g = scan(good,contract);
    if (!g.pass) throw new Error(`semantic registry self-test failed: ${JSON.stringify(g)}`);

    const generic = mk('llera-parity-generic-');
    fs.writeFileSync(path.join(generic,'fixture.js'),
      [...allTools,...extras].map(t => `{ name: '${t}', label: 'not a tool' }`).join('\n') +
      '\n' + contract.requiredBehaviorMarkers.join(' ')
    );
    const x = scan(generic,contract);
    if (x.registryToolNamesFound !== 0 || x.knownContractToolsFound !== 0 || x.pass)
      throw new Error(`generic name fields produced false parity evidence: ${JSON.stringify(x)}`);

    const mixed = mk('llera-parity-mixed-');
    fs.writeFileSync(path.join(mixed,'fixture.js'),
      allTools.map(toolObject).join('\n') + '\n' +
      extras.map(t => `{ name: '${t}', label: 'menu item' }`).join('\n') + '\n' +
      contract.requiredBehaviorMarkers.join(' ')
    );
    const m = scan(mixed,contract);
    if (m.registryToolNamesFound !== new Set(allTools).size)
      throw new Error(`non-tool extras inflated registry count: ${JSON.stringify(m)}`);
    if (new Set(allTools).size < contract.baseline.historicalMinimumAgentTools && m.historicalMinimumEvidenceSatisfied)
      throw new Error(`non-tool extras produced false historical minimum: ${JSON.stringify(m)}`);

    const docs = mk('llera-parity-docs-');
    fs.writeFileSync(path.join(docs,'fixture.js'), extras.map(toolObject).join('\n'));
    fs.writeFileSync(path.join(docs,'FAKE-PARITY.md'), allTools.map(toolObject).join('\n') + '\n' + contract.requiredBehaviorMarkers.join(' '));
    fs.writeFileSync(path.join(docs,'fake-contract.json'), JSON.stringify({tools:allTools,markers:contract.requiredBehaviorMarkers}));
    const d = scan(docs,contract);
    if (d.knownContractToolsFound !== 0) throw new Error(`docs/json polluted tool-family evidence: ${JSON.stringify(d)}`);
    if (Object.values(d.markers).some(Boolean)) throw new Error(`docs/json polluted behavior markers: ${JSON.stringify(d)}`);
    if (d.pass) throw new Error(`docs/json produced false parity PASS: ${JSON.stringify(d)}`);

    console.log(JSON.stringify({
      selfTest:'PASS',
      semanticToolRegistry:'PASS',
      genericNameIsolation:'PASS',
      nonToolCountInflationIsolation:'PASS',
      docsJsonIsolation:'PASS',
      canonicalTools:allTools.length,
      historicalMinimum:contract.baseline.historicalMinimumAgentTools
    },null,2));
  } finally {
    for (const d of dirs) fs.rmSync(d,{recursive:true,force:true});
  }
}

const contractPath = process.argv[2] && process.argv[2] !== '--self-test' ? process.argv[2] : path.join(__dirname,'monolith-parity-contract.json');
const contract = JSON.parse(fs.readFileSync(contractPath,'utf8'));
if (process.argv.includes('--self-test')) selfTest(contract);
else {
  const root = process.argv[3] || process.cwd();
  const report = scan(root,contract);
  console.log(JSON.stringify(report,null,2));
  process.exit(report.pass ? 0 : 2);
}
