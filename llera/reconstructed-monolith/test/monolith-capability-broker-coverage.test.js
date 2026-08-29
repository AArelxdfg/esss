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

  const outcomeMemory = {
    search(query, options) {
      calls.push({ name:'outcomeMemory', method:'search', args:[query, options] });
      return [{ id:'outcome-1', query, options }];
    }
  };

  const broker = new MonolithCapabilityBroker({
    filesystem: service('filesystem'),
    processes: service('processes'),
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

  assert.strictEqual(Object.keys(CAPABILITY_TOOL_BINDINGS).length, 33);

  const coverage = broker.coverage();
  assert.strictEqual(coverage.supportedCount, 33);
  assert.strictEqual(coverage.availableCount, 33);
  assert.strictEqual(coverage.unavailableCount, 0);

  const fsRead = await broker.invoke('read_file', { path:'C:/workspace/a.txt' }, { missionId:'m1' });
  assert.strictEqual(fsRead.name, 'filesystem');
  assert.strictEqual(fsRead.method, 'readFile');
  assert.strictEqual(fsRead.args[0].path, 'C:/workspace/a.txt');
  assert.strictEqual(fsRead.args[0].context.missionId, 'm1');

  const fsWrite = await broker.invoke('write_file', { path:'C:/workspace/a.txt', content:'ok' }, { stepId:'s1' });
  assert.strictEqual(fsWrite.method, 'writeFile');
  assert.strictEqual(fsWrite.args[0].context.stepId, 's1');

  const process = await broker.invoke('run_command', { command:'node --version' }, { missionId:'m1' });
  assert.strictEqual(process.name, 'processes');
  assert.strictEqual(process.method, 'runCommand');

  await broker.invoke('start_process', { command:'worker.exe' });
  await broker.invoke('process_status', { pid:42 });
  await broker.invoke('process_stop', { pid:42 });
  await broker.invoke('list_processes', {});
  await broker.invoke('read_process_output', { pid:42 });
  await broker.invoke('list_dir', { path:'C:/workspace' });
  await broker.invoke('search_files', { path:'C:/workspace', query:'MONOLITH' });
  await broker.invoke('read_text_range', { path:'C:/workspace/a.txt', start:1, end:3 });
  await broker.invoke('file_stat', { path:'C:/workspace/a.txt' });
  await broker.invoke('path_exists', { path:'C:/workspace/a.txt' });
  await broker.invoke('hash_file', { path:'C:/workspace/a.txt', algorithm:'sha256' });

  const outcome = await broker.invoke('outcome_search', {
    query:'runtime crash',
    limit:5,
    failuresOnly:true,
    verifiedOnly:true
  }, { missionId:'m1' });
  assert.strictEqual(outcome[0].query, 'runtime crash');
  assert.deepStrictEqual(outcome[0].options, {
    limit:5,
    failuresOnly:true,
    verifiedOnly:true
  });

  const snap = await broker.invoke('snapshot_create', {
    missionId:'m1',
    reason:'material-action'
  }, { stepId:'s1' });
  assert.strictEqual(snap.name, 'snapshots');
  assert.strictEqual(snap.method, 'create');
  assert.strictEqual(snap.args[0].missionId, 'm1');
  assert.strictEqual(snap.args[0].context.stepId, 's1');

  const restore = await broker.invoke('snapshot_restore', { missionId:'m1' });
  assert.strictEqual(restore.method, 'restore');

  const doctor = await broker.invoke('llera_doctor', { deep:true });
  assert.strictEqual(doctor.method, 'doctor');

  const bench = await broker.invoke('llera_bench', { preset:'smoke' });
  assert.strictEqual(bench.method, 'bench');

  await broker.invoke('knowledge_graph_search', { query:'llama recovery', limit:4 });
  await broker.invoke('skill_search', { text:'repair runtime', limit:3 });
  await broker.invoke('autonomy_status', {});
  await broker.invoke('vision_analyze_image', { path:'screen.png' });
  await broker.invoke('vision_ocr_screen', { windowId:'42' });
  await broker.invoke('evidence_record', { target:'x' });
  await broker.invoke('evidence_verify', { id:'ev1' });
  await broker.invoke('update_status', {});
  await broker.invoke('host_pressure_status', {});

  const partial = new MonolithCapabilityBroker({ evidence: service('evidence') });
  const partialCoverage = partial.coverage();
  assert.strictEqual(partialCoverage.availableCount, 2);
  assert(partialCoverage.unavailable.includes('snapshot_restore'));
  assert(partialCoverage.unavailable.includes('read_file'));

  await assert.rejects(
    () => partial.invoke('read_file', { path:'x' }),
    /filesystem capability unavailable/
  );

  await assert.rejects(
    () => partial.invoke('snapshot_restore', { missionId:'m1' }),
    /recovery snapshot coordinator unavailable/
  );

  await assert.rejects(
    () => broker.invoke('not_a_tool', {}),
    /unsupported restored capability tool/
  );

  console.log('MONOLITH capability broker expanded execution coverage PASS', {
    declaredCapabilityExecutors:33,
    priorCapabilityExecutors:14,
    newlyWiredExecutors:19,
    historicalFilesystemExecutors:13,
    historicalProcessExecutors:6,
    dependencyCoverageObservable:true,
    missingDependencyFailsClosed:true
  });
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
