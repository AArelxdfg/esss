'use strict';

const assert = require('assert');
const { MonolithCapabilityBroker, CAPABILITY_TOOL_BINDINGS } = require('../src/monolith-capability-broker');

(async () => {
  const calls = [];
  const service = name => new Proxy({}, {
    get(_target, method) {
      return async (...args) => {
        calls.push({ name, method:String(method), args });
        return { name, method:String(method), args };
      };
    }
  });
  const outcomeMemory = { search: async (...args) => ({ name:'outcomeMemory', method:'search', args }) };
  const broker = new MonolithCapabilityBroker({
    filesystem:service('filesystem'), processes:service('processes'), desktop:service('desktop'),
    browser:service('browser'), web:service('web'), cyberCore:service('cyberCore'), system:service('system'),
    clipboard:service('clipboard'), vision:service('vision'), evidence:service('evidence'), updater:service('updater'),
    hostguard:service('hostguard'), outcomeMemory, autonomy:service('autonomy'), knowledgeGraph:service('knowledgeGraph'),
    skills:service('skills'), snapshots:service('snapshots'), diagnostics:service('diagnostics')
  });

  assert.strictEqual(Object.keys(CAPABILITY_TOOL_BINDINGS).length, 62);
  assert.deepStrictEqual(broker.coverage(), {
    supportedCount:62, availableCount:62, unavailableCount:0,
    supported:Object.keys(CAPABILITY_TOOL_BINDINGS), available:Object.keys(CAPABILITY_TOOL_BINDINGS), unavailable:[]
  });

  for (const tool of Object.keys(CAPABILITY_TOOL_BINDINGS)) {
    const result = await broker.invoke(tool, argsFor(tool), { missionId:'mission-62', stepId:'step-62' });
    assert(result !== undefined, `${tool} must return through its adapter`);
  }

  const expectedFamilies = new Set([
    'filesystem','processes','desktop','browser','web','cyberCore','system','clipboard','vision','evidence','updater',
    'hostguard','outcomeMemory','autonomy','knowledgeGraph','skills','snapshots','diagnostics'
  ]);
  const calledFamilies = new Set(calls.map(call => call.name));
  for (const family of expectedFamilies) assert(calledFamilies.has(family), `${family} adapter was not exercised`);

  const browserCall = calls.find(call => call.name === 'browser' && call.method === 'click');
  assert.strictEqual(browserCall.args[0].context.missionId, 'mission-62');
  const desktopCall = calls.find(call => call.name === 'desktop' && call.method === 'launchApp');
  assert.strictEqual(desktopCall.args[0].context.stepId, 'step-62');

  const partial = new MonolithCapabilityBroker({ evidence:service('evidence') });
  assert.strictEqual(partial.coverage().availableCount, 2);
  assert.strictEqual(partial.coverage().unavailableCount, 60);
  await assert.rejects(() => partial.invoke('browser_click', {selector:'#x'}), /browser capability unavailable/);
  await assert.rejects(() => partial.invoke('launch_app', {app:'x'}), /desktop capability unavailable/);
  await assert.rejects(() => partial.invoke('web_search', {query:'x'}), /web capability unavailable/);
  await assert.rejects(() => partial.invoke('system_info', {}), /system capability unavailable/);

  console.log('MONOLITH 62-tool executable capability broker PASS');
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});

function argsFor(tool) {
  const table = {
    outcome_search:{query:'x'}, knowledge_graph_search:{query:'x'}, skill_search:{query:'x'},
    vision_analyze_image:{path:'screen.png'}, vision_ocr_screen:{windowId:'w1'}, evidence_record:{target:'x'},
    evidence_verify:{id:'ev1'}, snapshot_create:{missionId:'m1'}, snapshot_restore:{snapshotId:'s1'},
    browser_click:{tabId:'t1',selector:'#x'}, launch_app:{app:'notepad.exe'}, web_search:{query:'x'},
    search_cyber_core:{query:'x'}, clipboard_write:{text:'x'}, run_command:{command:'echo x'}, read_file:{path:'a'}
  };
  return table[tool] || {};
}
