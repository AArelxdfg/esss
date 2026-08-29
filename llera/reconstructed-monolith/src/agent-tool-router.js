'use strict';

const { RESTORED_MONOLITH_TOOLS } = require('./tool-surface');
const { CAPABILITY_TOOL_BINDINGS } = require('./monolith-capability-broker');

const SPECIALIZED_TOOLS = new Set(Object.keys(CAPABILITY_TOOL_BINDINGS));

class MonolithAgentToolRouter {
  constructor({ capabilityBroker, computerExecutor } = {}) {
    if (!capabilityBroker || typeof capabilityBroker.invoke !== 'function' || typeof capabilityBroker.coverage !== 'function') {
      throw new Error('capabilityBroker invoke/coverage is required');
    }
    if (!computerExecutor || typeof computerExecutor.invoke !== 'function') {
      throw new Error('computerExecutor.invoke is required');
    }
    this.capabilityBroker = capabilityBroker;
    this.computerExecutor = computerExecutor;
  }

  coverage() {
    const capability = this.capabilityBroker.coverage();
    const capabilityAvailable = new Set(capability.available || []);
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

      routes[tool] = 'computer';
      available.push(tool);
    }

    return {
      declaredCount: RESTORED_MONOLITH_TOOLS.length,
      specializedCount: SPECIALIZED_TOOLS.size,
      genericComputerCount: RESTORED_MONOLITH_TOOLS.length - SPECIALIZED_TOOLS.size,
      availableCount: available.length,
      unavailableCount: unavailable.length,
      available,
      unavailable,
      routes,
      fullExecutionSurfaceAvailable: unavailable.length === 0
    };
  }

  async invoke(tool, args = {}, context = {}) {
    if (!RESTORED_MONOLITH_TOOLS.includes(tool)) {
      throw new Error(`unknown MONOLITH tool: ${tool}`);
    }

    if (SPECIALIZED_TOOLS.has(tool)) {
      const coverage = this.capabilityBroker.coverage();
      if (!(coverage.available || []).includes(tool)) {
        throw new Error(`specialized MONOLITH capability unavailable: ${tool}`);
      }
      return this.capabilityBroker.invoke(tool, args, context);
    }

    return this.computerExecutor.invoke(tool, args, context);
  }

  routeFor(tool) {
    if (!RESTORED_MONOLITH_TOOLS.includes(tool)) return 'unknown';
    return SPECIALIZED_TOOLS.has(tool) ? 'specialized' : 'computer';
  }
}

module.exports = {
  MonolithAgentToolRouter,
  SPECIALIZED_TOOLS
};
