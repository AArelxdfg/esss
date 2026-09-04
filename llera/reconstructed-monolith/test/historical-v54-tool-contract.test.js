'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { RESTORED_MONOLITH_TOOLS } = require('../src/tool-surface');
const { HISTORICAL_V54_AGENT_TOOLS, compareToolSurface } = require('../src/historical-v54-tool-contract');

const EXPECTED_V54_TOOLS = [
  'list_dir','read_file','write_file','apply_patch','search_files','make_dir','copy_path','move_path','delete_path',
  'run_command','start_process','process_status','process_stop','list_apps','launch_app','focus_app','ui_snapshot','ui_invoke','close_app','desktop_screenshot',
  'vision_screen','vision_read_image','mouse_click','keyboard_type','key_press','browser_open','browser_google','browser_snapshot','browser_click','browser_type','browser_back','browser_show',
  'web_get','web_search','search_cyber_core','computer_map','procedure_search','outcome_search','autonomy_status','evolution_status','failure_doctrine','integrity_check','evolution_benchmark',
  'procedure_save','skill_list','skill_create','skill_trust','subagent_consult','doctor_run','snapshot_create','snapshot_list','snapshot_restore','browser_type_secret','web_download','vault_list',
  'run_secure_command','benchmark_run','simulation_create','mission_step','mission_next','mission_status','system_info'
];

test('historical V5.4 parity contract pins the exact recovered 62 public tool identities', () => {
  assert.equal(HISTORICAL_V54_AGENT_TOOLS.length, 62);
  assert.equal(new Set(HISTORICAL_V54_AGENT_TOOLS).size, 62);
  assert.deepEqual(HISTORICAL_V54_AGENT_TOOLS, EXPECTED_V54_TOOLS);
});

test('reconstructed 62-tool count is not mistaken for exact historical identity parity', () => {
  const parity = compareToolSurface(RESTORED_MONOLITH_TOOLS);
  assert.equal(parity.historicalCount, 62);
  assert.equal(parity.candidateCount, 62);
  assert.equal(parity.uniqueCandidateCount, 62);
  assert.equal(parity.exactIdentityParity, false);

  for (const required of [
    'vision_screen','vision_read_image','computer_map','procedure_search','evolution_status','failure_doctrine',
    'integrity_check','evolution_benchmark','procedure_save','skill_list','skill_create','skill_trust','subagent_consult',
    'doctor_run','snapshot_list','browser_type_secret','web_download','vault_list','run_secure_command','benchmark_run',
    'simulation_create','mission_step','mission_next','mission_status'
  ]) {
    assert.ok(parity.missingHistorical.includes(required), `expected historical gap: ${required}`);
  }
});

test('comparison reports exact identity parity only for the recovered V5.4 list', () => {
  const exact = compareToolSurface([...HISTORICAL_V54_AGENT_TOOLS]);
  assert.equal(exact.exactIdentityParity, true);
  assert.deepEqual(exact.missingHistorical, []);
  assert.deepEqual(exact.nonHistorical, []);
  assert.equal(exact.duplicateCount, 0);
});
