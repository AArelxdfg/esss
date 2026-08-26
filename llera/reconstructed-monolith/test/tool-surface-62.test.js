'use strict';
const assert = require('assert');
const { RESTORED_MONOLITH_TOOLS, ToolExecutionGuard } = require('../src/tool-surface');
const { MonolithCapabilityBroker } = require('../src/monolith-capability-broker');
const restoredSix = ['vision_analyze_image','vision_ocr_screen','evidence_record','evidence_verify','update_status','host_pressure_status'];
assert.strictEqual(new Set(RESTORED_MONOLITH_TOOLS).size, 62);
for (const t of restoredSix) {
  assert(RESTORED_MONOLITH_TOOLS.includes(t));
  const d = new ToolExecutionGuard().decide(t, {});
  assert.strictEqual(d.allow, true);
  assert.strictEqual(d.observation, true);
}
const calls=[];
const broker=new MonolithCapabilityBroker({
  vision:{analyze:async x=>(calls.push('vision'),{kind:x.kind}),ocrScreen:async()=> (calls.push('ocr'),{text:'LLera'})},
  evidence:{record:async()=> (calls.push('record'),{id:'ev-1'}),verify:async()=> (calls.push('verify'),{ok:true})},
  updater:{status:async()=> (calls.push('update'),{state:'idle'})},
  hostguard:{snapshot:async()=> (calls.push('host'),{pressure:'normal'})}
});
(async()=>{
  await broker.invoke('vision_analyze_image',{}); await broker.invoke('vision_ocr_screen',{});
  await broker.invoke('evidence_record',{}); await broker.invoke('evidence_verify',{});
  await broker.invoke('update_status',{}); await broker.invoke('host_pressure_status',{});
  assert.strictEqual(calls.length,6);
  console.log('MONOLITH 62-tool integrated parity PASS',{total:62,integrated:6});
})().catch(e=>{console.error(e);process.exit(1)});
