'use strict';
const assert = require('assert');
const {HISTORICAL_V2_TOOLS, RESTORED_MONOLITH_TOOLS, fingerprint, ToolExecutionGuard} = require('../src/tool-surface');

assert.strictEqual(new Set(HISTORICAL_V2_TOOLS).size, 34, 'V2 historical baseline must remain 34 unique tools');
assert.strictEqual(new Set(RESTORED_MONOLITH_TOOLS).size, 56, 'reconstructed V4 minimum must expose 56 unique tools');
for (const t of HISTORICAL_V2_TOOLS) assert(RESTORED_MONOLITH_TOOLS.includes(t), `missing historical tool ${t}`);

assert.strictEqual(fingerprint('read_file',{b:2,a:1}), fingerprint('read_file',{a:1,b:2}), 'fingerprint must be stable over key order');

const guard = new ToolExecutionGuard();
let d = guard.decide('write_file',{path:'a.txt',content:'x'});
assert(d.allow && d.material);
let r = guard.record('write_file',{path:'a.txt',content:'x'},{ok:true,at:'2026-08-26T10:00:00Z'});
assert(r.recorded && !guard.canFinalize(), 'material action must open verification debt');
assert.strictEqual(guard.decide('delete_path',{path:'b.txt'}).reason, 'verification_debt_open', 'second material action must be blocked');
r = guard.record('file_stat',{path:'a.txt'},{ok:true,at:'2026-08-26T10:00:01Z'});
assert(r.recorded && guard.canFinalize(), 'later independent observation must clear debt');

const failures = new ToolExecutionGuard();
assert(failures.record('browser_click',{selector:'#x'},{ok:false}).recorded);
assert(failures.record('browser_click',{selector:'#x'},{ok:false}).recorded);
assert.strictEqual(failures.decide('browser_click',{selector:'#x'}).reason, 'anti_loop_same_failure');

const restored = new ToolExecutionGuard();
restored.restore([
  {tool:'write_file',args:{path:'x'},fingerprint:'abc',ok:true,material:true,observation:false,at:'2026-08-26T10:00:00Z'}
]);
assert.strictEqual(restored.canFinalize(), false, 'open debt must survive restart');
assert.strictEqual(restored.decide('run_command',{cmd:'echo x'}).reason, 'verification_debt_open');
assert(restored.record('read_file',{path:'x'},{ok:true}).recorded);
assert(restored.canFinalize(), 'observation after restart must clear recovered debt');

console.log('tool-surface parity PASS', {historical:HISTORICAL_V2_TOOLS.length, restored:RESTORED_MONOLITH_TOOLS.length});
