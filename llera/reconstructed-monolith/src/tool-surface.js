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

// These tools can independently re-observe or verify state. Merely recording/asserting
// evidence is intentionally excluded: an evidence record is provenance, not proof that
// the material side effect actually happened.
const INDEPENDENT_VERIFICATION_TOOLS = new Set([
  'list_dir','read_file','search_files','read_text_range','file_stat','path_exists','hash_file',
  'process_status','list_processes','read_process_output','list_apps','ui_snapshot','desktop_screenshot',
  'browser_snapshot','browser_extract','web_get','web_search','system_info','clipboard_read','window_list',
  'llera_doctor','llera_bench','vision_analyze_image','vision_ocr_screen','evidence_verify','update_status','host_pressure_status'
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

function persistedOk(entry) {
  if (typeof entry.ok === 'boolean') return entry.ok;
  const outcome = String(entry.outcome || '').toLowerCase();
  return ['success','succeeded','ok','observed','verified','completed'].includes(outcome);
}

function normalizePath(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '').toLowerCase();
}

function verificationScope(tool, args = {}) {
  args = args || {};
  const pathValue = args.path || args.file || args.filePath || args.targetPath || args.destination || args.source;
  const normalizedPath = normalizePath(pathValue);
  if (normalizedPath) return `path:${normalizedPath}`;

  const pid = args.pid ?? args.processId;
  if (pid !== undefined && pid !== null && String(pid) !== '') return `process:${String(pid)}`;

  const windowId = args.windowId ?? args.hwnd;
  if (windowId !== undefined && windowId !== null && String(windowId) !== '') return `window:${String(windowId)}`;

  const browserId = args.tabId ?? args.pageId ?? args.browserId;
  if (browserId !== undefined && browserId !== null && String(browserId) !== '') return `browser:${String(browserId)}`;

  const url = args.url || args.href;
  if (typeof url === 'string' && url.trim()) {
    try {
      const parsed = new URL(url);
      return `url:${parsed.origin}${parsed.pathname}`.toLowerCase();
    } catch {
      return `url:${url.trim().toLowerCase()}`;
    }
  }

  if (tool === 'clipboard_write' || tool === 'clipboard_read') return 'clipboard:system';
  if (tool === 'snapshot_restore' || tool === 'snapshot_create') {
    const id = args.snapshotId || args.id || args.name;
    return id ? `snapshot:${String(id)}` : 'snapshot:latest';
  }
  return null;
}

function explicitVerificationFingerprint(entry) {
  return entry && (entry.verifiesFingerprint || entry.verifies || entry.verificationOf || entry.materialFingerprint) || null;
}

function observationVerifiesDebt(entry, debt) {
  if (!entry || !debt || !entry.observation || !entry.ok || entry.material) return false;
  if (!INDEPENDENT_VERIFICATION_TOOLS.has(entry.tool)) return false;
  if (entry.tool === debt.tool) return false;

  const entryScope = entry.scope || verificationScope(entry.tool, entry.args || entry.arguments || {});
  const explicit = explicitVerificationFingerprint(entry);

  // Fingerprint binding identifies which material action is being verified, but it
  // must never be allowed to bypass a known resource/target binding. Otherwise a
  // planner could attach the right fingerprint to an unrelated observation such as
  // system_info and falsely discharge a scoped write/delete/browser debt.
  if (debt.scope) {
    if (!entryScope || entryScope !== debt.scope) return false;
    if (explicit && explicit !== debt.fingerprint) return false;
    return true;
  }

  // Unscoped material actions have no resource identity to compare, so require an
  // explicit fingerprint binding to the exact material action. A generic
  // `verification:true` flag remains insufficient because it is self-assertable.
  return Boolean(explicit && explicit === debt.fingerprint);
}

class ToolExecutionGuard {
  constructor({maxSameFailure = 2} = {}) {
    this.maxSameFailure = maxSameFailure;
    this.history = [];
    this.verificationDebt = null;
  }

  restore(toolTrace = []) {
    this.history = [];
    this.verificationDebt = null;
    for (const raw of toolTrace) {
      if (!raw || !raw.tool) continue;
      const cls = this.classify(raw.tool);
      const rawArgs = raw.args || raw.arguments || {};
      const fp = raw.fingerprint || raw.argumentsHash || fingerprint(raw.tool, rawArgs);
      const entry = {
        ...raw,
        args: rawArgs,
        fingerprint: fp,
        ok: persistedOk(raw),
        material: typeof raw.material === 'boolean' ? raw.material : cls.material,
        observation: typeof raw.observation === 'boolean' ? raw.observation : (Boolean(raw.verification) || cls.observation),
        scope: raw.scope || verificationScope(raw.tool, rawArgs)
      };
      this.history.push(entry);
      if (entry.material && entry.ok) {
        this.verificationDebt = { fingerprint: entry.fingerprint, tool: entry.tool, scope: entry.scope || null, at: entry.at || null };
      }
      if (observationVerifiesDebt(entry, this.verificationDebt)) {
        const debt = this.verificationDebt;
        const material = [...this.history].reverse().find(x => x.fingerprint === debt.fingerprint && x.material && x.ok);
        if (material) { material.verifiedBy = entry.fingerprint; entry.verifies = debt.fingerprint; }
        this.verificationDebt = null;
      }
    }
    return { restored: this.history.length, verificationDebt: this.verificationDebt ? {...this.verificationDebt} : null };
  }

  classify(tool) { return { material: MATERIAL_TOOLS.has(tool), observation: OBSERVATION_TOOLS.has(tool) }; }

  decide(tool, args = {}) {
    if (!RESTORED_MONOLITH_TOOLS.includes(tool)) return {allow:false, reason:'unknown_tool'};
    const fp = fingerprint(tool, args);
    const cls = this.classify(tool);
    const scope = verificationScope(tool, args);
    const same = this.history.filter(x => x.fingerprint === fp);
    const failures = same.filter(x => x.ok === false).length;
    if (failures >= this.maxSameFailure) return {allow:false, reason:'anti_loop_same_failure', fingerprint:fp};
    const last = same.at(-1);
    if (last && last.ok === true && !cls.observation) return {allow:false, reason:'anti_loop_recent_success', fingerprint:fp};
    if (this.verificationDebt && cls.material) return {allow:false, reason:'verification_debt_open', fingerprint:fp};
    return {allow:true, fingerprint:fp, scope, ...cls};
  }

  record(tool, args, {ok, resultSummary='', at = new Date().toISOString(), verifiesFingerprint = null, verification = false} = {}) {
    const decision = this.decide(tool, args);
    if (!decision.allow) return {...decision, recorded:false};
    const entry = { tool, args:stable(args), fingerprint:decision.fingerprint, ok:Boolean(ok), material:decision.material, observation:decision.observation, scope:decision.scope || null, resultSummary, at, verification:Boolean(verification), verifiesFingerprint:verifiesFingerprint || null };
    this.history.push(entry);
    if (entry.material && entry.ok) this.verificationDebt = {fingerprint: entry.fingerprint, tool, scope: entry.scope || null, at};
    if (observationVerifiesDebt(entry, this.verificationDebt)) {
      const debt = this.verificationDebt;
      const material = [...this.history].reverse().find(x => x.fingerprint === debt.fingerprint && x.material);
      if (material) material.verifiedBy = entry.fingerprint;
      this.verificationDebt = null;
      entry.verifies = debt.fingerprint;
    }
    return {...entry, recorded:true};
  }

  canFinalize() { return !this.verificationDebt; }
}

module.exports = { HISTORICAL_V2_TOOLS, RESTORED_MONOLITH_TOOLS, MATERIAL_TOOLS, OBSERVATION_TOOLS, INDEPENDENT_VERIFICATION_TOOLS, fingerprint, verificationScope, observationVerifiesDebt, ToolExecutionGuard };
