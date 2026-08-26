'use strict';

const crypto = require('crypto');

const HISTORICAL_V2_TOOLS = [
  'list_dir','read_file','write_file','apply_patch','search_files','make_dir','copy_path','move_path','delete_path',
  'run_command','start_process','process_status','process_stop',
  'list_apps','launch_app','focus_app','ui_snapshot','ui_invoke','close_app','desktop_screenshot','mouse_click','keyboard_type','key_press',
  'browser_open','browser_google','browser_snapshot','browser_click','browser_type','browser_back','browser_show',
  'web_get','web_search','search_cyber_core','system_info'
];

const RESTORED_MONOLITH_TOOLS = [
  ...HISTORICAL_V2_TOOLS,
  'read_text_range','file_stat','path_exists','hash_file','list_processes','read_process_output',
  'browser_reload','browser_close','browser_extract','browser_download',
  'clipboard_read','clipboard_write','window_list','window_move_resize',
  'outcome_search','autonomy_status','knowledge_graph_search','skill_search',
  'snapshot_create','snapshot_restore','llera_doctor','llera_bench',
  'vision_analyze_image','vision_ocr_screen','evidence_record','evidence_verify','update_status','host_pressure_status'
];

const MATERIAL_TOOLS = new Set([
  'write_file','apply_patch','make_dir','copy_path','move_path','delete_path','run_command','start_process','process_stop',
  'launch_app','ui_invoke','close_app','mouse_click','keyboard_type','key_press','browser_click','browser_type','browser_download',
  'clipboard_write','window_move_resize','snapshot_restore'
]);

const OBSERVATION_TOOLS = new Set([
  'list_dir','read_file','search_files','read_text_range','file_stat','path_exists','hash_file','process_status','list_processes','read_process_output',
  'list_apps','ui_snapshot','desktop_screenshot','browser_snapshot','browser_extract','web_get','web_search','search_cyber_core','system_info',
  'clipboard_read','window_list','outcome_search','autonomy_status','knowledge_graph_search','skill_search','llera_doctor','llera_bench',
  'vision_analyze_image','vision_ocr_screen','evidence_record','evidence_verify','update_status','host_pressure_status'
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((o, k) => { o[k] = stable(value[k]); return o; }, {});
  }
  return value;
}

function fingerprint(tool, args = {}) {
  return crypto.createHash('sha256').update(JSON.stringify([tool, stable(args)])).digest('hex');
}

class ToolExecutionGuard {
  constructor({maxSameFailure = 2} = {}) {
    this.maxSameFailure = maxSameFailure;
    this.history = [];
    this.verificationDebt = null;
  }

  restore(toolTrace = []) {
    this.history = toolTrace.map(x => ({...x}));
    const open = [...this.history].reverse().find(x => x.material && !x.verifiedBy);
    this.verificationDebt = open ? {fingerprint: open.fingerprint, tool: open.tool, at: open.at} : null;
  }

  classify(tool) {
    return {
      material: MATERIAL_TOOLS.has(tool),
      observation: OBSERVATION_TOOLS.has(tool)
    };
  }

  decide(tool, args = {}) {
    if (!RESTORED_MONOLITH_TOOLS.includes(tool)) return {allow:false, reason:'unknown_tool'};
    const fp = fingerprint(tool, args);
    const cls = this.classify(tool);
    const same = this.history.filter(x => x.fingerprint === fp);
    const failures = same.filter(x => x.ok === false).length;
    if (failures >= this.maxSameFailure) return {allow:false, reason:'anti_loop_same_failure', fingerprint:fp};
    const last = same.at(-1);
    if (last && last.ok === true && !cls.observation) return {allow:false, reason:'anti_loop_recent_success', fingerprint:fp};
    if (this.verificationDebt && cls.material) return {allow:false, reason:'verification_debt_open', fingerprint:fp};
    return {allow:true, fingerprint:fp, ...cls};
  }

  record(tool, args, {ok, resultSummary='', at = new Date().toISOString()} = {}) {
    const decision = this.decide(tool, args);
    if (!decision.allow) return {...decision, recorded:false};
    const entry = {tool, args:stable(args), fingerprint:decision.fingerprint, ok:Boolean(ok), material:decision.material, observation:decision.observation, resultSummary, at};
    this.history.push(entry);
    if (entry.material && entry.ok) this.verificationDebt = {fingerprint: entry.fingerprint, tool, at};
    if (entry.observation && entry.ok && this.verificationDebt) {
      const debt = this.verificationDebt;
      const material = [...this.history].reverse().find(x => x.fingerprint === debt.fingerprint && x.material);
      if (material) material.verifiedBy = entry.fingerprint;
      this.verificationDebt = null;
      entry.verifies = debt.fingerprint;
    }
    return {...entry, recorded:true};
  }

  canFinalize() {
    return !this.verificationDebt;
  }
}

module.exports = {
  HISTORICAL_V2_TOOLS,
  RESTORED_MONOLITH_TOOLS,
  MATERIAL_TOOLS,
  OBSERVATION_TOOLS,
  fingerprint,
  ToolExecutionGuard
};
