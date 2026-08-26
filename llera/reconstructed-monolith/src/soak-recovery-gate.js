'use strict';

class SoakRecoveryGate {
  constructor({ runtime, missionEngine, watchdog, hostGuard, evidenceVerifier, now = () => Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
    if (!runtime || !missionEngine || !watchdog || !hostGuard || typeof evidenceVerifier !== 'function') {
      throw new Error('runtime, missionEngine, watchdog, hostGuard and evidenceVerifier are required');
    }
    this.runtime = runtime; this.missionEngine = missionEngine; this.watchdog = watchdog; this.hostGuard = hostGuard;
    this.evidenceVerifier = evidenceVerifier; this.now = now; this.sleep = sleep;
  }

  async run({ model, cycles = 25, recoveryEvery = 7, pressureEvery = 5, missionId, maxRecoveryCount = 8 } = {}) {
    if (!model || !missionId) throw new Error('model and missionId are required');
    if (!Number.isInteger(cycles) || cycles < 5) throw new Error('cycles must be an integer >= 5');
    const startedAt = this.now();
    const report = { schema: 1, model, missionId, cycles, startedAt, completedCycles: 0, runtimeRecoveries: 0,
      pressureEvents: 0, missionResumes: 0, watchdogSafeModeEvents: 0, evidenceChecks: 0, failures: [] };
    await this.runtime.ensureRunning(model, 'soak-start');

    for (let i = 1; i <= cycles; i++) {
      try {
        const pressureSample = i % pressureEvery === 0
          ? { commitPercent: 94, diskActivePercent: 98, diskQueue: 6, pagesPerSec: 1200, cpuPercent: 91 }
          : { commitPercent: 52, diskActivePercent: 25, diskQueue: 0.2, pagesPerSec: 20, cpuPercent: 35 };
        const pressure = await this.hostGuard.evaluate(pressureSample);
        if (pressure.level && String(pressure.level).toUpperCase() === 'CRITICAL') {
          report.pressureEvents += 1;
          if (typeof this.runtime.applyHostPressure === 'function') await this.runtime.applyHostPressure('CRITICAL');
        }
        if (i % recoveryEvery === 0) {
          await this.runtime.recover(`soak-cycle-${i}`);
          report.runtimeRecoveries += 1;
        }
        const mission = this.missionEngine.getMission(missionId);
        if (!mission) throw new Error('mission disappeared during soak');
        if (mission.status === 'interrupted') {
          await this.missionEngine.startMission(missionId);
          report.missionResumes += 1;
        }
        const evidenceOk = await this.evidenceVerifier({ cycle: i, missionId, runtime: this.runtime.snapshot ? this.runtime.snapshot() : null });
        report.evidenceChecks += 1;
        if (!evidenceOk) throw new Error(`evidence verification failed at cycle ${i}`);
        const profile = await this.watchdog.launchProfile();
        if (profile && profile.mode === 'safe') {
          report.watchdogSafeModeEvents += 1;
          throw new Error(`watchdog entered safe mode at cycle ${i}`);
        }
        const runtimeState = this.runtime.snapshot ? this.runtime.snapshot() : { state: 'unknown' };
        if (runtimeState.state !== 'ready') throw new Error(`runtime not ready at cycle ${i}`);
        report.completedCycles += 1;
        await this.sleep(0);
      } catch (error) {
        report.failures.push({ cycle: i, message: String(error && error.message || error), at: this.now() });
        break;
      }
    }

    const finalRuntime = this.runtime.snapshot ? this.runtime.snapshot() : null;
    const finalMission = this.missionEngine.getMission(missionId);
    report.finishedAt = this.now();
    report.durationMs = report.finishedAt - startedAt;
    report.finalRuntime = finalRuntime;
    report.finalMissionStatus = finalMission ? finalMission.status : 'missing';
    const gates = {
      completedAllCycles: report.completedCycles === cycles,
      runtimeReady: Boolean(finalRuntime && finalRuntime.state === 'ready'),
      desiredModelPreserved: Boolean(finalRuntime && finalRuntime.desiredModel === model),
      recoveryBudgetRespected: report.runtimeRecoveries <= maxRecoveryCount,
      evidenceContinuous: report.evidenceChecks === cycles,
      noWatchdogSafeMode: report.watchdogSafeModeEvents === 0,
      missionPreserved: Boolean(finalMission),
      noFailures: report.failures.length === 0,
    };
    report.gates = gates;
    report.pass = Object.values(gates).every(Boolean);
    return report;
  }
}

module.exports = { SoakRecoveryGate };
