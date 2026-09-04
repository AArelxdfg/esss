'use strict';

// Exact agent tool identities recovered from the hash-verified historical
// LLera V5.4.0 MONOLITH AURORA UX source archive on 2026-09-04.
//
// Keep this list immutable as a parity contract. The reconstructed runtime may
// expose compatibility aliases or additional internal tools, but historical
// V5.4 parity must be measured against these exact 62 public identities rather
// than a merely equal-sized reconstructed surface.
const HISTORICAL_V54_AGENT_TOOLS = Object.freeze([
  'list_dir','read_file','write_file','apply_patch','search_files','make_dir','copy_path','move_path','delete_path',
  'run_command','start_process','process_status','process_stop',
  'list_apps','launch_app','focus_app','ui_snapshot','ui_invoke','close_app','desktop_screenshot',
  'vision_screen','vision_read_image','mouse_click','keyboard_type','key_press',
  'browser_open','browser_google','browser_snapshot','browser_click','browser_type','browser_back','browser_show',
  'web_get','web_search','search_cyber_core','computer_map','procedure_search','outcome_search','autonomy_status',
  'evolution_status','failure_doctrine','integrity_check','evolution_benchmark','procedure_save','skill_list','skill_create',
  'skill_trust','subagent_consult','doctor_run','snapshot_create','snapshot_list','snapshot_restore','browser_type_secret',
  'web_download','vault_list','run_secure_command','benchmark_run','simulation_create','mission_step','mission_next',
  'mission_status','system_info'
]);

function validatedCandidateTools(candidate) {
  if (!Array.isArray(candidate)) return [];
  for (const tool of candidate) {
    // Tool identities cross a parity/security boundary. Never coerce arbitrary
    // objects here: Array#sort/String coercion can execute attacker-controlled
    // valueOf/toString hooks while merely checking the advertised tool surface.
    if (typeof tool !== 'string') throw new TypeError('tool identity must be a string');
  }
  return candidate;
}

function compareToolSurface(candidate = []) {
  const candidateTools = validatedCandidateTools(candidate);
  const historical = new Set(HISTORICAL_V54_AGENT_TOOLS);
  const current = new Set(candidateTools);
  const missingHistorical = HISTORICAL_V54_AGENT_TOOLS.filter(tool => !current.has(tool));
  const nonHistorical = [...current].filter(tool => !historical.has(tool)).sort();
  const duplicateCount = candidateTools.length - current.size;
  return {
    historicalCount: HISTORICAL_V54_AGENT_TOOLS.length,
    candidateCount: candidateTools.length,
    uniqueCandidateCount: current.size,
    duplicateCount,
    missingHistorical,
    nonHistorical,
    exactIdentityParity: duplicateCount === 0 && missingHistorical.length === 0 && nonHistorical.length === 0
  };
}

module.exports = { HISTORICAL_V54_AGENT_TOOLS, compareToolSurface };
