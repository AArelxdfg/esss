'use strict';

const { RESTORED_MONOLITH_TOOLS } = require('./tool-surface');
const { CAPABILITY_TOOL_BINDINGS } = require('./monolith-capability-broker');

const SPECIALIZED_TOOLS = new Set(Object.keys(CAPABILITY_TOOL_BINDINGS));
const RESTORED_TOOL_SET = new Set(RESTORED_MONOLITH_TOOLS);

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
  return {
    declaredCount: RESTORED_MONOLITH_TOOLS.length,
    uniqueCount: RESTORED_TOOL_SET.size,
    specializedCount: SPECIALIZED_TOOLS.size,
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
    const capabilityAvailable = new Set(Array.isArray(capability && capability.available) ? capability.available.map(String) : []);
    const computer = this.computerExecutor.coverage();
    const computerAvailable = new Set(Array.isArray(computer && computer.available) ? computer.available.map(String) : []);
    const available = [];
    const unavailable = [];
    const routes = {};

    for (const tool of RESTORED_MONOLITH_TOOLS) {
      if (SPECIALIZED_TOOLS.has(tool)) {
        const ok = capabilityAvailable.has(tool);
        routes[tool] = ok ? 'specialized' : 'unavailable-specialized';
        (ok ? available : unavailable).push(tool);
        continue;
      }

      const ok = computerAvailable.has(tool);
      routes[tool] = ok ? 'computer' : 'unavailable-computer';
      (ok ? available : unavailable).push(tool);
    }

    return {
      declaredCount: TOOL_SURFACE_INTEGRITY.declaredCount,
      uniqueDeclaredCount: TOOL_SURFACE_INTEGRITY.uniqueCount,
      specializedCount: TOOL_SURFACE_INTEGRITY.specializedCount,
      genericComputerCount: TOOL_SURFACE_INTEGRITY.genericComputerCount,
      availableCount: available.length,
      unavailableCount: unavailable.length,
      available,
      unavailable,
      routes,
      specializedCoverage: capability || null,
      computerCoverage: computer || null,
      toolSurfaceIntegrity: TOOL_SURFACE_INTEGRITY,
      fullExecutionSurfaceAvailable: unavailable.length === 0 && available.length === TOOL_SURFACE_INTEGRITY.uniqueCount
    };
  }

  async invoke(tool, args = {}, context = {}) {
    if (!RESTORED_TOOL_SET.has(tool)) {
      throw new Error(`unknown MONOLITH tool: ${tool}`);
    }

    if (SPECIALIZED_TOOLS.has(tool)) {
      const coverage = this.capabilityBroker.coverage();
      const available = Array.isArray(coverage && coverage.available) ? coverage.available : [];
      if (!available.includes(tool)) {
        throw new Error(`specialized MONOLITH capability unavailable: ${tool}`);
      }
      return this.capabilityBroker.invoke(tool, args, context);
    }

    const computerCoverage = this.computerExecutor.coverage();
    const available = Array.isArray(computerCoverage && computerCoverage.available) ? computerCoverage.available : [];
    if (!available.includes(tool)) {
      throw new Error(`computer MONOLITH capability unavailable: ${tool}`);
    }
    return this.computerExecutor.invoke(tool, args, context);
  }

  routeFor(tool) {
    if (!RESTORED_TOOL_SET.has(tool)) return 'unknown';
    return SPECIALIZED_TOOLS.has(tool) ? 'specialized' : 'computer';
  }
}

module.exports = {
  MonolithAgentToolRouter,
  SPECIALIZED_TOOLS,
  RESTORED_TOOL_SET,
  TOOL_SURFACE_INTEGRITY,
  assertToolSurfaceIntegrity
};
