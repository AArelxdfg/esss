'use strict';

const assert = require('assert');
const Module = require('module');

const capabilityTools = [
  'vision_analyze_image','vision_ocr_screen','evidence_record','evidence_verify',
  'update_status','host_pressure_status','outcome_search','autonomy_status',
  'knowledge_graph_search','skill_search','snapshot_create','snapshot_restore',
  'llera_doctor','llera_bench'
];
const allTools = ['read_file', ...capabilityTools];

class FakeGuard {
  constructor() { this.verificationDebt = null; this.history = []; }
  restore() { return {restored:0}; }
  decide(tool,args) {
    if (!allTools.includes(tool)) return {allow:false,reason:'unknown_tool'};
    return {allow:true,fingerprint:`fp:${tool}`,material:tool==='snapshot_restore',observation:tool!=='snapshot_restore'};
  }
  record(tool,args,{ok,resultSummary}) {
    const entry={tool,args,ok,resultSummary,recorded:true,material:tool==='snapshot_restore'};
    this.history.push(entry);
    return entry;
  }
  canFinalize() { return true; }
}
class FakeFailureDoctrine {
  restore() { return {restored:0}; }
  summarize() { return {failures:0}; }
  recordFailure() { return {decision:{action:'replan'}}; }
}
class FakeCapabilityBroker {
  constructor() { this.calls=[]; }
  coverage() { return {supportedCount:14,availableCount:14,unavailableCount:0,available:[...capabilityTools],unavailable:[]}; }
  async invoke(tool,args,context) {
    this.calls.push({tool,args,context});
    return {ok:true,route:'capability',tool};
  }
}

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === './tool-surface') {
    return {RESTORED_MONOLITH_TOOLS:allTools, ToolExecutionGuard:FakeGuard};
  }
  if (request === './monolith-capability-broker') {
    return {
      MonolithCapabilityBroker:FakeCapabilityBroker,
      CAPABILITY_TOOL_BINDINGS:Object.fromEntries(capabilityTools.map(t=>[t,['svc','method']]))
    };
  }
  if (request === './failure-doctrine') return {FailureDoctrine:FakeFailureDoctrine};
  return originalLoad.apply(this, arguments);
};

const { GuardedMonolithToolBroker, SPECIAL_CAPABILITIES } = require('../src/guarded-tool-broker');
Module._load = originalLoad;

(async () => {
  assert.strictEqual(SPECIAL_CAPABILITIES.size, 14);

  let historicalCalls = 0;
  const capabilityBroker = new FakeCapabilityBroker();
  const broker = new GuardedMonolithToolBroker({
    historicalExecutor: async (tool,args,context) => {
      historicalCalls += 1;
      return {ok:true,route:'historical',tool};
    },
    capabilityBroker,
    guard:new FakeGuard(),
    failureDoctrine:new FakeFailureDoctrine()
  });

  const status = broker.status({missionId:'m1'});
  assert.strictEqual(status.specializedCapabilityCount, 14);
  assert.strictEqual(status.capabilityCoverage.availableCount, 14);

  for (const tool of capabilityTools) {
    const result = await broker.invoke(tool,{q:tool},{missionId:'m1'});
    assert.strictEqual(result.ok,true);
    assert.strictEqual(result.result.route,'capability', `${tool} bypassed capability broker`);
  }

  assert.strictEqual(capabilityBroker.calls.length,14);
  assert.strictEqual(historicalCalls,0,'specialized tools must not fall through historicalExecutor');

  const ordinary = await broker.invoke('read_file',{path:'x'},{missionId:'m1'});
  assert.strictEqual(ordinary.result.route,'historical');
  assert.strictEqual(historicalCalls,1);

  console.log('MONOLITH guarded broker 14-capability routing PASS', {
    specializedCapabilities:14,
    historicalBypassForSpecialized:0,
    capabilityCoverageExposed:true,
    ordinaryHistoricalRoutePreserved:true
  });
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
