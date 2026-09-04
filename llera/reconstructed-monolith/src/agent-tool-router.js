'use strict';

const { RESTORED_MONOLITH_TOOLS } = require('./tool-surface');
const {
  CAPABILITY_TOOL_BINDINGS,
  HISTORICAL_V54_CAPABILITY_ALIASES,
  normalizeCapabilityTool
} = require('./monolith-capability-broker');

const SPECIALIZED_TOOLS = new Set(Object.keys(CAPABILITY_TOOL_BINDINGS));
const HISTORICAL_ALIAS_TOOLS = new Set(Object.keys(HISTORICAL_V54_CAPABILITY_ALIASES));
const RESTORED_TOOL_SET = new Set(RESTORED_MONOLITH_TOOLS);

function toStringSet(value) {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.filter(item => typeof item === 'string' && item.trim()).map(String));
}

function capabilityAttestation(coverage, tool) {
  const normalizedTool = normalizeCapabilityTool(tool);
  const available = toStringSet(coverage && coverage.available);
  const supported = toStringSet(coverage && coverage.supported);
  return available.has(normalizedTool) && supported.has(normalizedTool);
}

function computerAttestation(coverage, tool) {
  const available = toStringSet(coverage && coverage.available);
  const portable = toStringSet(coverage && coverage.portable);
  const adapterBacked = toStringSet(coverage && coverage.adapterBacked);
  return available.has(tool) && (portable.has(tool) || adapterBacked.has(tool));
}

function assertToolSurfaceIntegrity() {
  if (!Array.isArray(RESTORED_MONOLITH_TOOLS) || RESTORED_MONOLITH_TOOLS.length === 0) {
    throw new Error('MONOLITH tool surface must be a non-empty array');
  }
  if (RESTORED_TOOL_SET.size !== RESTORED_MONOLITH_TOOLS.length) {
    throw new Error('MONOLITH tool surface contains duplicate tool identities');
  }
  for (const tool of RESTORED_TOOL_SET) {
    if (typeof tool !== 'string' || !tool.trim()) {
      throw new Error('MONOLITH tool surface contains an invalid tool identity');
    }
  }
  for (const tool of SPECIALIZED_TOOLS) {
    if (!RESTORED_TOOL_SET.has(tool)) {
      throw new Error(`specialized MONOLITH binding is outside declared tool surface: ${tool}`);
    }
  }
  for (const [historical, reconstructed] of Object.entries(HISTORICAL_V54_CAPABILITY_ALIASES)) {
    if (!SPECIALIZED_TOOLS.has(reconstructed)) {
      throw new Error(`historical V5.4 alias has no specialized target: ${historical} -> ${reconstructed}`);
    }
  }
  return {
    declaredCount: RESTORED_MONOLITH_TOOLS.length,
    uniqueCount: RESTORED_TOOL_SET.size,
    specializedCount: SPECIALIZED_TOOLS.size,
    historicalAliasCount: HISTORICAL_ALIAS_TOOLS.size,
    genericComputerCount: RESTORED_TOOL_SET.size - SPECIALIZED_TOOLS.size
  };
}

const TOOL_SURFACE_INTEGRITY = Object.freeze(assertToolSurfaceIntegrity());

class MonolithAgentToolRouter {
  constructor({ capabilityBroker, computerExecutor } = {}) {
    if (!capabilityBroker || typeof capabilityBroker.invoke !== 'function' || typeof capabilityBroker.coverage !== 'function') {
      throw new Error('capabilityBroker invoke/coverage is required');
    }
    if (!computerExecutor || typeof computerExecutor.invoke !== 'function' || typeof computerExecutor.coverage !== 'function') {
      throw new Error('computerExecutor invoke/coverage is required');
    }
    this.capabilityBroker = capabilityBroker;
    this.computerExecutor = computerExecutor;
  }

  coverage() {
    const capability = this.capabilityBroker.coverage();
    const computer = this.computerExecutor.coverage();
    const available = [];
    const unavailable = [];
    const routes = {};
    const unattested = [];

    for (const tool of RESTORED_MONOLITH_TOOLS) {
      if (SPECIALIZED_TOOLS.has(tool)) {
        const ok = capabilityAttestation(capability, tool);
        routes[tool] = ok ? 'specialized' : 'unavailable-specialized';
        (ok ? available : unavailable).push(tool);
        if (!ok) unattested.push(tool);
        continue;
      }

      const ok = computerAttestation(computer, tool);
      routes[tool] = ok ? 'computer' : 'unavailable-computer';
      (ok ? available : unavailable).push(tool);
      if (!ok) unattested.push(tool);
    }

    const historicalCompatibility = Object.keys(HISTORICAL_V54_CAPABILITY_ALIASES).map(tool => ({
      tool,
      target: normalizeCapabilityTool(tool),
      route: 'specialized-compat',
      available: capabilityAttestation(capability, tool)
    }));

    return {
      declaredCount: TOOL_SURFACE_INTEGRITY.declaredCount,
      uniqueDeclaredCount: TOOL_SURFACE_INTEGRITY.uniqueCount,
      specializedCount: TOOL_SURFACE_INTEGRITY.specializedCount,
      historicalAliasCount: TOOL_SURFACE_INTEGRITY.historicalAliasCount,
      genericComputerCount: TOOL_SURFACE_INTEGRITY.genericComputerCount,
      availableCount: available.length,
      unavailableCount: unavailable.length,
      attestedCount: available.length,
      unattestedCount: unattested.length,
      available,
      unavailable,
      unattested,
      routes,
      historicalCompatibility,
      historicalCompatibilityAvailableCount: historicalCompatibility.filter(item => item.available).length,
      specializedCoverage: capability || null,
      computerCoverage: computer || null,
      toolSurfaceIntegrity: TOOL_SURFACE_INTEGRITY,
      fullExecutionSurfaceAvailable: unavailable.length === 0 && available.length === TOOL_SURFACE_INTEGRITY.uniqueCount
    };
  }

  async invoke(tool, args = {}, context = {}) {
    const isHistoricalAlias = HISTORICAL_ALIAS_TOOLS.has(tool);
    const normalizedTool = normalizeCapabilityTool(tool);

    if (!RESTORED_TOOL_SET.has(tool) && !isHistoricalAlias) {
      throw new Error(`unknown MONOLITH tool: ${tool}`);
    }

    if (SPECIALIZED_TOOLS.has(normalizedTool)) {
      const coverage = this.capabilityBroker.coverage();
      if (!capabilityAttestation(coverage, tool)) {
        throw new Error(`specialized MONOLITH capability unavailable or unattested: ${tool}`);
      }
      return this.capabilityBroker.invoke(tool, args, context);
    }

    const computerCoverage = this.computerExecutor.coverage();
    if (!computerAttestation(computerCoverage, tool)) {
      throw new Error(`computer MONOLITH capability unavailable or unattested: ${tool}`);
    }
    return this.computerExecutor.invoke(tool, args, context);
  }

  routeFor(tool) {
    if (HISTORICAL_ALIAS_TOOLS.has(tool)) return 'specialized-compat';
    if (!RESTORED_TOOL_SET.has(tool)) return 'unknown';
    return SPECIALIZED_TOOLS.has(tool) ? 'specialized' : 'computer';
  }
}

module.exports = {
  MonolithAgentToolRouter,
  SPECIALIZED_TOOLS,
  HISTORICAL_ALIAS_TOOLS,
  RESTORED_TOOL_SET,
  TOOL_SURFACE_INTEGRITY,
  assertToolSurfaceIntegrity,
  capabilityAttestation,
  computerAttestation
};
