'use strict';

const assert = require('assert');
const { MonolithCapabilityBroker, CAPABILITY_TOOL_BINDINGS } = require('../src/monolith-capability-broker');
const { RESTORED_MONOLITH_TOOLS } = require('../src/tool-surface');

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

  const outcomeMemory = {
    search(query, options) {
      calls.push({ name:'outcomeMemory', method:'search', args:[query, options] });
      return [{ id:'outcome-1', query, options }];
    }
  };

  const broker = new MonolithCapabilityBroker({
    filesystem: service('filesystem'),
    processes: service('processes'),
    desktop: service('desktop'),
    browser: service('browser'),
    web: service('web'),
    cyberCore: service('cyberCore'),
    system: service('system'),
    clipboard: service('clipboard'),
    vision: service('vision'),
    evidence: service('evidence'),
    updater: service('updater'),
    hostguard: service('hostguard'),
    outcomeMemory,
    autonomy: service('autonomy'),
    knowledgeGraph: service('knowledgeGraph'),
    skills: service('skills'),
    snapshots: service('snapshots'),
    diagnostics: service('diagnostics')
  });

  assert.strictEqual(RESTORED_MONOLITH_TOOLS.length, 62);
  assert.strictEqual(Object.keys(CAPABILITY_TOOL_BINDINGS).length, 62);
  assert.deepStrictEqual(
    [...Object.keys(CAPABILITY_TOOL_BINDINGS)].sort(),
    [...RESTORED_MONOLITH_TOOLS].sort(),
    'every declared MONOLITH tool must have an executable broker binding'
  );

  const coverage = broker.coverage();
  assert.strictEqual(coverage.supportedCount, 62);
  assert.strictEqual(coverage.availableCount, 62);
  assert.strictEqual(coverage.unavailableCount, 0);

  // Every declared tool must execute through a real injected adapter surface.
  for (const tool of RESTORED_MONOLITH_TOOLS) {
    await broker.invoke(tool, sampleArgs(tool), { missionId:'m-all', stepId:'s-all' });
  }

  // Representative argument/context checks across the newly restored service families.
  const fsRead = await broker.invoke('read_file', { path:'C:/workspace/a.txt' }, { missionId:'m1' });
  assert.strictEqual(fsRead.name, 'filesystem');
  assert.strictEqual(fsRead.method, 'readFile');
  assert.strictEqual(fsRead.args[0].context.missionId, 'm1');

  const launch = await broker.invoke('launch_app', { app:'notepad.exe' }, { missionId:'m2' });
  assert.strictEqual(launch.name, 'desktop');
  assert.strictEqual(launch.method, 'launchApp');
  assert.strictEqual(launch.args[0].context.missionId, 'm2');

  const click = await broker.invoke('browser_click', { tabId:'t1', selector:'#go' }, { stepId:'s2' });
  assert.strictEqual(click.name, 'browser');
  assert.strictEqual(click.method, 'click');
  assert.strictEqual(click.args[0].context.stepId, 's2');

  const web = await broker.invoke('web_search', { query:'MONOLITH OMEGA' }, { missionId:'m3' });
  assert.strictEqual(web.name, 'web');
  assert.strictEqual(web.method, 'search');

  const core = await broker.invoke('search_cyber_core', { query:'CVE test' });
  assert.strictEqual(core.name, 'cyberCore');
  assert.strictEqual(core.method, 'search');

  const info = await broker.invoke('system_info', {});
  assert.strictEqual(info.name, 'system');
  assert.strictEqual(info.method, 'info');

  const clip = await broker.invoke('clipboard_write', { text:'proof' }, { missionId:'m4' });
  assert.strictEqual(clip.name, 'clipboard');
  assert.strictEqual(clip.method, 'write');
  assert.strictEqual(clip.args[0].context.missionId, 'm4');

  const outcome = await broker.invoke('outcome_search', {
    query:'runtime crash', limit:5, failuresOnly:true, verifiedOnly:true
  });
  assert.strictEqual(outcome[0].query, 'runtime crash');
  assert.deepStrictEqual(outcome[0].options, { limit:5, failuresOnly:true, verifiedOnly:true });

  // Missing adapter dependencies remain fail-closed and observable through coverage().
  const partial = new MonolithCapabilityBroker({ evidence: service('evidence') });
  const partialCoverage = partial.coverage();
  assert.strictEqual(partialCoverage.availableCount, 2);
  assert.strictEqual(partialCoverage.unavailableCount, 60);
  assert(partialCoverage.unavailable.includes('browser_click'));
  assert(partialCoverage.unavailable.includes('launch_app'));
  assert(partialCoverage.unavailable.includes('read_file'));

  await assert.rejects(
    () => partial.invoke('browser_click', { selector:'#x' }),
    /browser capability unavailable/
  );
  await assert.rejects(
    () => partial.invoke('launch_app', { app:'x.exe' }),
    /desktop capability unavailable/
  );
  await assert.rejects(
    () => partial.invoke('read_file', { path:'x' }),
    /filesystem capability unavailable/
  );
  await assert.rejects(
    () => broker.invoke('not_a_tool', {}),
    /unsupported restored capability tool/
  );

  console.log('MONOLITH capability broker full 62-tool execution coverage PASS', {
    declaredCapabilityExecutors:62,
    priorCapabilityExecutors:33,
    newlyWiredExecutors:29,
    fullDeclaredSurfaceBound:true,
    contextPropagationVerified:true,
    missingDependencyFailsClosed:true
  });
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});

function sampleArgs(tool) {
  const byTool = {
    list_dir:{path:'C:/workspace'}, read_file:{path:'C:/workspace/a.txt'}, write_file:{path:'C:/workspace/a.txt',content:'x'},
    apply_patch:{path:'C:/workspace/a.txt',patch:'x'}, search_files:{path:'C:/workspace',query:'x'}, make_dir:{path:'C:/workspace/x'},
    copy_path:{source:'a',destination:'b'}, move_path:{source:'a',destination:'b'}, delete_path:{path:'x'},
    run_command:{command:'echo x'}, start_process:{command:'worker.exe'}, process_status:{pid:1}, process_stop:{pid:1},
    list_apps:{}, launch_app:{app:'notepad.exe'}, focus_app:{app:'notepad.exe'}, ui_snapshot:{}, ui_invoke:{controlId:'x'},
    close_app:{app:'notepad.exe'}, desktop_screenshot:{}, mouse_click:{x:1,y:1}, keyboard_type:{text:'x'}, key_press:{key:'ENTER'},
    browser_open:{url:'https://example.test'}, browser_google:{query:'x'}, browser_snapshot:{tabId:'t1'}, browser_click:{tabId:'t1',selector:'#x'},
    browser_type:{tabId:'t1',selector:'#x',text:'x'}, browser_back:{tabId:'t1'}, browser_show:{tabId:'t1'},
    web_get:{url:'https://example.test'}, web_search:{query:'x'}, search_cyber_core:{query:'x'}, system_info:{},
    read_text_range:{path:'a',start:1,end:2}, file_stat:{path:'a'}, path_exists:{path:'a'}, hash_file:{path:'a'},
    list_processes:{}, read_process_output:{pid:1}, browser_reload:{tabId:'t1'}, browser_close:{tabId:'t1'},
    browser_extract:{tabId:'t1',selector:'body'}, browser_download:{tabId:'t1',url:'https://example.test/a'},
    clipboard_read:{}, clipboard_write:{text:'x'}, window_list:{}, window_move_resize:{windowId:'w1',x:0,y:0,width:800,height:600},
    outcome_search:{query:'x'}, autonomy_status:{}, knowledge_graph_search:{query:'x'}, skill_search:{query:'x'},
    snapshot_create:{missionId:'m'}, snapshot_restore:{snapshotId:'s'}, llera_doctor:{}, llera_bench:{},
    vision_analyze_image:{path:'screen.png'}, vision_ocr_screen:{windowId:'w1'}, evidence_record:{target:'x'}, evidence_verify:{id:'ev1'},
    update_status:{}, host_pressure_status:{}
  };
  return byTool[tool] || {};
}
