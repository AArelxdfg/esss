'use strict';

const { MonolithComputerExecutor } = require('./monolith-computer-executor');
const { MonolithCapabilityBroker } = require('./monolith-capability-broker');
const { MonolithAgentToolRouter } = require('./agent-tool-router');
const { GuardedMonolithToolBroker } = require('./guarded-tool-broker');
const { MissionToolCoordinator } = require('./mission-tool-coordinator');

function createMonolithToolRuntime({
  missionEngine,
  recoverySnapshots = null,
  autoCheckpoint = true,
  workspaceRoot,
  allowOutsideWorkspace = false,
  computerAdapter = null,
  browserAdapter = null,
  webSearch = null,
  cyberSearch = null,
  fetchImpl,
  capabilityServices = {},
  guard,
  failureDoctrine,
  summarizeResult,
  computerExecutor = null,
  capabilityBroker = null
} = {}) {
  if (!missionEngine) throw new Error('missionEngine is required');

  const computer = computerExecutor || new MonolithComputerExecutor({
    workspaceRoot,
    allowOutsideWorkspace,
    computerAdapter,
    browserAdapter,
    webSearch,
    cyberSearch,
    fetchImpl
  });

  if (!computer || typeof computer.invoke !== 'function' || typeof computer.coverage !== 'function') {
    throw new Error('computer executor invoke/coverage is required');
  }

  const capabilities = capabilityBroker || new MonolithCapabilityBroker(capabilityServices);
  if (!capabilities || typeof capabilities.invoke !== 'function' || typeof capabilities.coverage !== 'function') {
    throw new Error('capability broker invoke/coverage is required');
  }

  const router = new MonolithAgentToolRouter({
    capabilityBroker: capabilities,
    computerExecutor: computer
  });

  const guardedBroker = new GuardedMonolithToolBroker({
    historicalExecutor: (tool, args, context) => router.invoke(tool, args, context),
    capabilityBroker: capabilities,
    guard,
    failureDoctrine,
    summarizeResult
  });

  const missionTools = new MissionToolCoordinator({
    missionEngine,
    broker: guardedBroker,
    recoverySnapshots,
    autoCheckpoint
  });

  const coverage = () => {
    const routed = router.coverage();
    return {
      ...routed,
      workspaceMode: allowOutsideWorkspace ? 'full-pc-explicit' : 'workspace-scoped',
      physicalAdaptersPresent: Boolean(computerAdapter || browserAdapter),
      physicalValidationClaimed: false
    };
  };

  return Object.freeze({
    computerExecutor: computer,
    capabilityBroker: capabilities,
    router,
    guardedBroker,
    missionTools,
    coverage
  });
}

module.exports = { createMonolithToolRuntime };
