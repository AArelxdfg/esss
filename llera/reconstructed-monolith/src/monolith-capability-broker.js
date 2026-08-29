'use strict';

const CAPABILITY_TOOL_BINDINGS = Object.freeze({
  // Historical V2 filesystem/process surface restored as executable service bindings.
  list_dir: ['filesystem', 'listDir'],
  read_file: ['filesystem', 'readFile'],
  write_file: ['filesystem', 'writeFile'],
  apply_patch: ['filesystem', 'applyPatch'],
  search_files: ['filesystem', 'searchFiles'],
  make_dir: ['filesystem', 'makeDir'],
  copy_path: ['filesystem', 'copyPath'],
  move_path: ['filesystem', 'movePath'],
  delete_path: ['filesystem', 'deletePath'],
  read_text_range: ['filesystem', 'readTextRange'],
  file_stat: ['filesystem', 'stat'],
  path_exists: ['filesystem', 'exists'],
  hash_file: ['filesystem', 'hashFile'],

  run_command: ['processes', 'runCommand'],
  start_process: ['processes', 'start'],
  process_status: ['processes', 'status'],
  process_stop: ['processes', 'stop'],
  list_processes: ['processes', 'list'],
  read_process_output: ['processes', 'readOutput'],

  // Reconstructed MONOLITH capability services.
  vision_analyze_image: ['vision', 'analyze'],
  vision_ocr_screen: ['vision', 'ocrScreen'],
  evidence_record: ['evidence', 'record'],
  evidence_verify: ['evidence', 'verify'],
  update_status: ['updater', 'status'],
  host_pressure_status: ['hostguard', 'snapshot'],
  outcome_search: ['outcomeMemory', 'search'],
  autonomy_status: ['autonomy', 'status'],
  knowledge_graph_search: ['knowledgeGraph', 'search'],
  skill_search: ['skills', 'search'],
  snapshot_create: ['snapshots', 'create'],
  snapshot_restore: ['snapshots', 'restore'],
  llera_doctor: ['diagnostics', 'doctor'],
  llera_bench: ['diagnostics', 'bench']
});

const DIRECT_ARG_TOOLS = new Set([
  'list_dir','read_file','write_file','apply_patch','search_files','make_dir','copy_path','move_path','delete_path',
  'read_text_range','file_stat','path_exists','hash_file',
  'run_command','start_process','process_status','process_stop','list_processes','read_process_output'
]);

class MonolithCapabilityBroker {
  constructor({
    filesystem,
    processes,
    vision,
    evidence,
    updater,
    hostguard,
    outcomeMemory,
    autonomy,
    knowledgeGraph,
    skills,
    snapshots,
    diagnostics
  } = {}) {
    Object.assign(this, {
      filesystem, processes,
      vision, evidence, updater, hostguard, outcomeMemory,
      autonomy, knowledgeGraph, skills, snapshots, diagnostics
    });
  }

  coverage() {
    const supported = Object.keys(CAPABILITY_TOOL_BINDINGS);
    const available = [];
    const unavailable = [];

    for (const tool of supported) {
      const [serviceName, methodName] = CAPABILITY_TOOL_BINDINGS[tool];
      const service = this[serviceName];
      if (service && typeof service[methodName] === 'function') available.push(tool);
      else unavailable.push(tool);
    }

    return {
      supportedCount: supported.length,
      availableCount: available.length,
      unavailableCount: unavailable.length,
      supported,
      available,
      unavailable
    };
  }

  async invoke(tool, args = {}, context = {}) {
    if (DIRECT_ARG_TOOLS.has(tool)) {
      const [serviceName, methodName] = CAPABILITY_TOOL_BINDINGS[tool];
      return this._call(serviceName, methodName, `${serviceName} capability unavailable`, { ...args, context });
    }

    switch (tool) {
      case 'vision_analyze_image':
        return this._call('vision', 'analyze', 'vision pipeline unavailable',
          { ...args, kind: args.kind || 'image', context });

      case 'vision_ocr_screen':
        return this._call('vision', 'ocrScreen', 'windows OCR unavailable',
          { ...args, context });

      case 'evidence_record':
        return this._call('evidence', 'record', 'evidence ledger unavailable',
          { ...args, context });

      case 'evidence_verify':
        return this._call('evidence', 'verify', 'evidence ledger unavailable',
          { ...args, context });

      case 'update_status':
        return this._call('updater', 'status', 'update lifecycle unavailable',
          { ...args, context });

      case 'host_pressure_status':
        return this._call('hostguard', 'snapshot', 'HOSTGUARD unavailable',
          { ...args, context });

      case 'outcome_search': {
        const query = args.query ?? args.text ?? '';
        const options = args.options || {
          limit: args.limit,
          failuresOnly: args.failuresOnly,
          verifiedOnly: args.verifiedOnly
        };
        return this._call('outcomeMemory', 'search', 'outcome memory unavailable', query, compact(options));
      }

      case 'autonomy_status':
        return this._call('autonomy', 'status', 'autonomy controller unavailable',
          { ...args, context });

      case 'knowledge_graph_search': {
        const query = args.query ?? args.text ?? '';
        return this._call('knowledgeGraph', 'search', 'knowledge graph unavailable',
          query, { ...args, query: undefined, text: undefined, context });
      }

      case 'skill_search': {
        const query = args.query ?? args.text ?? '';
        return this._call('skills', 'search', 'skill registry unavailable',
          query, { ...args, query: undefined, text: undefined, context });
      }

      case 'snapshot_create':
        return this._call('snapshots', 'create', 'recovery snapshot coordinator unavailable',
          { ...args, context });

      case 'snapshot_restore':
        return this._call('snapshots', 'restore', 'recovery snapshot coordinator unavailable',
          { ...args, context });

      case 'llera_doctor':
        return this._call('diagnostics', 'doctor', 'LLera diagnostics unavailable',
          { ...args, context });

      case 'llera_bench':
        return this._call('diagnostics', 'bench', 'LLera diagnostics unavailable',
          { ...args, context });

      default:
        throw new Error(`unsupported restored capability tool: ${tool}`);
    }
  }

  async _call(serviceName, methodName, unavailableMessage, ...args) {
    const service = this[serviceName];
    if (!service || typeof service[methodName] !== 'function') {
      throw new Error(unavailableMessage);
    }
    return service[methodName](...args);
  }
}

function compact(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, v]) => v !== undefined));
}

module.exports = { MonolithCapabilityBroker, CAPABILITY_TOOL_BINDINGS, DIRECT_ARG_TOOLS };
