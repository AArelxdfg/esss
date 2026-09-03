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

const capabilityBindings = {
  vision_analyze_image: ['vision','analyze'],
  vision_ocr_screen: ['vision','ocrScreen'],
  evidence_record: ['evidence','record'],
  evidence_verify: ['evidence','verify'],
  update_status: ['updater','status'],
  host_pressure_status: ['hostguard','snapshot'],
  outcome_search: ['outcomeMemory','search'],
  autonomy_status: ['autonomy','status'],
  knowledge_graph_search: ['knowledgeGraph','search'],
  skill_search: ['skills','search'],
  snapshot_create: ['snapshots','create'],
  snapshot_restore: ['snapshots','restore'],
  llera_doctor: ['diagnostics','doctor'],
  llera_bench: ['diagnostics','bench']
};

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === './tool-surface') return { RESTORED_MONOLITH_TOOLS: restored };
  if (request === './monolith-capability-broker') return { CAPABILITY_TOOL_BINDINGS: capabilityBindings };
  return originalLoad.apply(this, arguments);
};
const { MonolithAgentToolRouter, SPECIALIZED_TOOLS } = require('../src/agent-tool-router');
Module._load = originalLoad;

(async () => {
  assert.strictEqual(restored.length, 62);
  assert.strictEqual(SPECIALIZED_TOOLS.size, 14);

  const specializedCalls = [];
  const genericCalls = [];
  const genericTools = restored.filter(t => !SPECIALIZED_TOOLS.has(t));
  const capabilityBroker = {
    coverage() {
      return {
        supported: Object.keys(capabilityBindings),
        available: Object.keys(capabilityBindings),
        unavailable: [],
        availableCount: 14,
        unavailableCount: 0
      };
    },
    async invoke(tool, args, context) {
      specializedCalls.push({tool,args,context});
      return { route:'specialized', tool, args, context };
    }
  };
  const computerExecutor = {
    coverage() {
      return {
        available:[...genericTools],
        unavailable:[],
        portable:[...genericTools],
        adapterBacked:[],
        availableCount:genericTools.length,
        unavailableCount:0
      };
    },
    async invoke(tool, args, context) {
      genericCalls.push({tool,args,context});
      return { route:'computer', tool, args, context };
    }
  };

  const router = new MonolithAgentToolRouter({ capabilityBroker, computerExecutor });
  const coverage = router.coverage();

  assert.strictEqual(coverage.declaredCount, 62);
  assert.strictEqual(coverage.specializedCount, 14);
  assert.strictEqual(coverage.genericComputerCount, 48);
  assert.strictEqual(coverage.availableCount, 62);
  assert.strictEqual(coverage.unavailableCount, 0);
  assert.strictEqual(coverage.attestedCount, 62);
  assert.strictEqual(coverage.unattestedCount, 0);
  assert.strictEqual(coverage.fullExecutionSurfaceAvailable, true);

  for (const tool of Object.keys(capabilityBindings)) {
    assert.strictEqual(router.routeFor(tool), 'specialized');
  }
  for (const tool of genericTools) {
    assert.strictEqual(router.routeFor(tool), 'computer');
  }

  const generic = await router.invoke('read_file', {path:'a.txt'}, {missionId:'m1'});
  assert.strictEqual(generic.route, 'computer');
  assert.strictEqual(genericCalls.length, 1);
  assert.strictEqual(specializedCalls.length, 0);

  const specialized = await router.invoke('evidence_verify', {id:'ev1'}, {missionId:'m1'});
  assert.strictEqual(specialized.route, 'specialized');
  assert.strictEqual(specializedCalls.length, 1);
  assert.strictEqual(genericCalls.length, 1);

  const partialBroker = {
    coverage() {
      return {
        supported:Object.keys(capabilityBindings),
        available:['evidence_record'],
        unavailable:['evidence_verify']
      };
    },
    async invoke() { throw new Error('must not be invoked for unavailable specialized tool'); }
  };
  const failClosed = new MonolithAgentToolRouter({ capabilityBroker:partialBroker, computerExecutor });
  await assert.rejects(
    () => failClosed.invoke('evidence_verify', {id:'ev2'}),
    /specialized MONOLITH capability unavailable or unattested/
  );
  assert.strictEqual(genericCalls.length, 1, 'generic executor must not bypass specialized capability gate');

  const partialComputerExecutor = {
    coverage() {
      return {
        available:['read_file'],
        unavailable:genericTools.filter(t=>t!=='read_file'),
        portable:['read_file'],
        adapterBacked:[]
      };
    },
    async invoke(tool,args,context) { return {route:'computer',tool,args,context}; }
  };
  const genericFailClosed = new MonolithAgentToolRouter({capabilityBroker,computerExecutor:partialComputerExecutor});
  const partialCoverage = genericFailClosed.coverage();
  assert.strictEqual(partialCoverage.fullExecutionSurfaceAvailable,false);
  assert.strictEqual(partialCoverage.routes.read_file,'computer');
  assert.strictEqual(partialCoverage.routes.write_file,'unavailable-computer');
  await assert.rejects(
    () => genericFailClosed.invoke('write_file',{path:'x',content:'x'}),
    /computer MONOLITH capability unavailable or unattested/
  );

  const spoofedSpecialized = {
    coverage() {
      return {supported:['evidence_record'],available:['evidence_verify']};
    },
    async invoke() { throw new Error('coverage spoof must not reach invoke'); }
  };
  const specializedSpoofGuard = new MonolithAgentToolRouter({capabilityBroker:spoofedSpecialized,computerExecutor});
  assert.strictEqual(specializedSpoofGuard.coverage().routes.evidence_verify,'unavailable-specialized');
  await assert.rejects(
    () => specializedSpoofGuard.invoke('evidence_verify',{}),
    /unavailable or unattested/
  );

  const spoofedComputer = {
    coverage() {
      return {available:['read_file'],portable:[],adapterBacked:[]};
    },
    async invoke() { throw new Error('coverage spoof must not reach invoke'); }
  };
  const computerSpoofGuard = new MonolithAgentToolRouter({capabilityBroker,computerExecutor:spoofedComputer});
  assert.strictEqual(computerSpoofGuard.coverage().routes.read_file,'unavailable-computer');
  await assert.rejects(
    () => computerSpoofGuard.invoke('read_file',{}),
    /unavailable or unattested/
  );

  await assert.rejects(
    () => router.invoke('not_a_real_tool', {}),
    /unknown MONOLITH tool/
  );

  console.log('MONOLITH 62-tool execution router PASS', {
    declaredTools:62,
    specializedExecutors:14,
    computerExecutorRoutes:48,
    fullSurfaceRoutableWhenDependenciesPresent:true,
    executableCoverageAttestationRequired:true,
    specializedCoverageSpoofBlocked:true,
    computerCoverageSpoofBlocked:true,
    specializedFallbackBypassBlocked:true,
    genericAvailabilityMustBeDeclared:true,
    genericUnavailableFailsClosed:true,
    unknownToolsFailClosed:true
  });
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
