'use strict';

const assert = require('assert');
const Module = require('module');

const historical = [
  'list_dir','read_file','write_file','apply_patch','search_files','make_dir','copy_path','move_path','delete_path',
  'run_command','start_process','process_status','process_stop',
  'list_apps','launch_app','focus_app','ui_snapshot','ui_invoke','close_app','desktop_screenshot','mouse_click','keyboard_type','key_press',
  'browser_open','browser_google','browser_snapshot','browser_click','browser_type','browser_back','browser_show',
  'web_get','web_search','search_cyber_core','system_info'
];
const restored = [
  ...historical,
  'read_text_range','file_stat','path_exists','hash_file','list_processes','read_process_output',
  'browser_reload','browser_close','browser_extract','browser_download',
  'clipboard_read','clipboard_write','window_list','window_move_resize',
  'outcome_search','autonomy_status','knowledge_graph_search','skill_search',
  'snapshot_create','snapshot_restore','llera_doctor','llera_bench',
  'vision_analyze_image','vision_ocr_screen','evidence_record','evidence_verify','update_status','host_pressure_status'
];
const bindings = {
  vision_analyze_image:['vision','analyze'], vision_ocr_screen:['vision','ocrScreen'],
  evidence_record:['evidence','record'], evidence_verify:['evidence','verify'],
  update_status:['updater','status'], host_pressure_status:['hostguard','snapshot'],
  outcome_search:['outcomeMemory','search'], autonomy_status:['autonomy','status'],
  knowledge_graph_search:['knowledgeGraph','search'], skill_search:['skills','search'],
  snapshot_create:['snapshots','create'], snapshot_restore:['snapshots','restore'],
  llera_doctor:['diagnostics','doctor'], llera_bench:['diagnostics','bench']
};

function freshLoad(surface, capabilityBindings) {
  const target = require.resolve('../src/agent-tool-router');
  delete require.cache[target];
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === './tool-surface') return {RESTORED_MONOLITH_TOOLS:surface};
    if (request === './monolith-capability-broker') return {CAPABILITY_TOOL_BINDINGS:capabilityBindings};
    return originalLoad.apply(this, arguments);
  };
  try { return require('../src/agent-tool-router'); }
  finally { Module._load = originalLoad; delete require.cache[target]; }
}

(async () => {
  assert.strictEqual(restored.length, 62);
  assert.strictEqual(new Set(restored).size, 62);

  const valid = freshLoad(restored, bindings);
  assert.strictEqual(valid.TOOL_SURFACE_INTEGRITY.declaredCount, 62);
  assert.strictEqual(valid.TOOL_SURFACE_INTEGRITY.uniqueCount, 62);
  assert.strictEqual(valid.TOOL_SURFACE_INTEGRITY.specializedCount, 14);
  assert.strictEqual(valid.TOOL_SURFACE_INTEGRITY.genericComputerCount, 48);

  const duplicateSurface = [...restored.slice(0, -1), restored[0]];
  assert.strictEqual(duplicateSurface.length, 62, 'adversarial surface keeps the superficial count at 62');
  assert.throws(
    () => freshLoad(duplicateSurface, bindings),
    /duplicate tool identities/,
    '62 entries must not pass when fewer than 62 distinct tool identities exist'
  );

  assert.throws(
    () => freshLoad(restored, {...bindings, phantom_privileged_tool:['phantom','invoke']}),
    /outside declared tool surface/,
    'specialized bindings must not silently expand beyond the parity contract'
  );

  const {MonolithAgentToolRouter} = valid;
  const router = new MonolithAgentToolRouter({
    capabilityBroker:{coverage:()=>({available:null}),invoke:async()=>({})},
    computerExecutor:{coverage:()=>({available:'not-an-array'}),invoke:async()=>({})}
  });
  const coverage = router.coverage();
  assert.strictEqual(coverage.uniqueDeclaredCount, 62);
  assert.strictEqual(coverage.availableCount, 0);
  assert.strictEqual(coverage.unavailableCount, 62);
  assert.strictEqual(coverage.fullExecutionSurfaceAvailable, false);
  await assert.rejects(() => router.invoke('read_file',{}), /computer MONOLITH capability unavailable/);
  await assert.rejects(() => router.invoke('evidence_record',{}), /specialized MONOLITH capability unavailable/);

  console.log('MONOLITH distinct 62-tool identity contract PASS', {
    declared:62,
    distinct:62,
    duplicateCountSpoofBlocked:true,
    outOfContractSpecializedBindingBlocked:true,
    malformedCoverageFailsClosed:true
  });
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
