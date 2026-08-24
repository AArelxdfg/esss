# LLera — Windows-Grade Sprint Gate

Date: 2026-08-24
Target baseline: **V5.3.5 MONOLITH OMEGA EVIDENCE LEDGER**

This directory is intentionally non-runtime and non-breaking. It defines the acceptance gate that every next LLera build must pass before the project is described as Windows-grade.

## Proven baseline carried forward

V5.3.5 already has:

- HOSTGUARD host-pressure governor and single inference runtime behavior inherited from V5.3.2.
- Agent anti-loop and verification-debt guarantees inherited from V5.3.3.
- Abortable low-priority inference and adaptive preemption under critical host pressure.
- Structured evidence ledger with evidence ID, target binding and SHA-256 result hashes.
- Installer self-test capability flags through schema 535.

## Windows-grade means measurable gates, not feature count

A candidate build is **REJECTED** if any REQUIRED gate below fails.

### G0 — Artifact identity

- [ ] Installer SHA-256 equals the release/build manifest.
- [ ] Installer is PE32+ AMD64.
- [ ] Version reported by installed LLera matches the candidate version.
- [ ] Installer writes only the intended LLera payload and passes its own installed-app self-test.

### G1 — Boot and first useful response

- [ ] Clean launch reaches a responsive UI without blank assistant bubbles.
- [ ] A usable local inference runtime is available without silently preloading an oversized preferred model.
- [ ] Queueing a prompt during runtime startup produces visible status and eventually drains correctly.
- [ ] No indefinite loading state; timeout produces a concrete recoverable error.

### G2 — Host survival

- [ ] llama-server count never exceeds one during normal HOSTGUARD model switching.
- [ ] Runtime and Vision children are BelowNormal priority where Windows permits it.
- [ ] Elevated/critical commit or disk pressure reduces background work instead of freezing the desktop.
- [ ] Critical pressure can preempt low-priority Model Council/verifier inference.
- [ ] Critical pressure blocks or unloads Vision before system responsiveness is sacrificed.
- [ ] Downloads reduce concurrency under pressure.

### G3 — Crash and restart recovery

- [ ] Killing the active llama-server causes bounded automatic recovery.
- [ ] Killing LLera during a persistent mission does not lose the durable checkpoint/tool trace.
- [ ] Restart reconstructs anti-loop history and open verification debt.
- [ ] Interrupted material actions are re-observed before retry.
- [ ] A failed model switch rolls back to the last known working runtime.

### G4 — Agent proof, not agent theater

- [ ] Same tool + same arguments cannot loop after repeated failure.
- [ ] Material external actions create verification debt.
- [ ] A second material action/final answer is blocked until an independent observation satisfies the debt.
- [ ] Planner fallback/recovery paths cannot bypass the debt.
- [ ] Strict verifier consumes structured evidence IDs/targets/hashes.
- [ ] Persistent missions cannot claim success without successful tool evidence.

### G5 — Local security boundary

- [ ] Inference/Vision control ports listen only on loopback.
- [ ] No unauthenticated LAN listener is introduced by developer/update/runtime bridges.
- [ ] Secret output redaction remains active.
- [ ] Credential vault remains OS-protected.
- [ ] Update manifest/artifact integrity verification remains enforced.
- [ ] Update signing private material is not packaged in the application.

### G6 — UI quality and resilience

- [ ] 1366x768, 1920x1080 and 2560x1440 have no clipped primary controls.
- [ ] 125%, 150% and 200% DPI preserve usable composer, navigation and Operations panels.
- [ ] Long tool output and long Turkish text cannot lock layout or horizontal-scroll the whole shell.
- [ ] Activity/Operations/evidence surfaces remain responsive while inference is busy.
- [ ] Window close/minimize/maximize, tray restore and taskbar behavior work repeatedly.
- [ ] UI clearly differentiates queued, running, verifying, blocked, failed and completed work.

### G7 — Installer / update / uninstall lifecycle

- [ ] Upgrade from the previous stable build preserves user data and removes stale shortcuts/payloads.
- [ ] Interrupted update does not leave LLera unlaunchable.
- [ ] Rollback leaves a launchable last-known-good build.
- [ ] Uninstall can preserve or remove user models/data deliberately; it does not silently destroy them.
- [ ] Reinstall after uninstall has no stale-version launch path.

### G8 — Soak gate

Before release candidate promotion:

- [ ] 2-hour interactive soak with chat + work mission + browser/terminal/vision mix.
- [ ] 50 model/runtime health cycles without empty final responses.
- [ ] 10 forced llama-server failures with successful recovery.
- [ ] 5 LLera process restarts during persistent missions with checkpoint recovery.
- [ ] No unbounded process/RSS growth attributable to LLera orchestration.

## Current hard blocker

The V5.3.5 build report is available, but the corresponding source archive is not present in the connected GitHub repository or retrievable File Library surface. The public repository currently contains only the signed-update manifest under `llera/stable.json`.

Therefore this sprint directory must not pretend runtime source was modified. It establishes the hard validation contract now and is the landing zone for Windows-machine evidence until the source tree is restored.

## Runner

Use `windows-grade-gate.ps1` on the Windows machine. It is observation-first and non-destructive by default. Destructive recovery probes require explicit switches.

Example:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\windows-grade-gate.ps1 `
  -InstallerPath "C:\path\LLera_V5_3_5_MONOLITH_OMEGA_EVIDENCE_LEDGER_Setup.exe" `
  -ExpectedInstallerSha256 "1852b9c116fca9c4107e814b556956028d4732f4f04a00f606908d47667b9d2e"
```

The script writes a timestamped JSON result in `artifacts\` and exits non-zero when a required gate fails.
