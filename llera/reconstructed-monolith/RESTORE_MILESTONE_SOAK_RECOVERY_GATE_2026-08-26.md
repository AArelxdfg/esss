# LLera MONOLITH Restore — Soak/Recovery Gate Milestone

## Scope
Adds a deterministic soak/recovery acceptance gate over the reconstructed MONOLITH runtime, mission, HOSTGUARD, evidence-verification and crash-watchdog contracts.

## Source
- `src/soak-recovery-gate.js`
- SHA-256: `db77bd1dd8a1465049a6019dcdfcbf46ec9c5aace47035be1aa67b6ef09df421`

## Test
- `test/soak-recovery-gate.test.js`
- SHA-256: `c5e2a93e52d9c6617851b3712d96857bb9b1159116cea0a91e5d759262fbe94b`
- Local Node result: `MONOLITH soak/recovery gate PASS { cycles: 35, recoveries: 5, pressureEvents: 7, evidenceChecks: 35 }`

## Acceptance behaviors covered
- Runtime remains READY across repeated recovery cycles.
- Desired model identity is preserved across recovery.
- Critical HOSTGUARD pressure is injected repeatedly and delegated to runtime pressure handling.
- Persistent mission identity must remain present throughout the soak.
- Interrupted missions are explicitly resumed instead of silently reset.
- Evidence verification must remain continuous on every cycle.
- Watchdog safe-mode is a hard failure during the healthy soak profile.
- Recovery count must remain inside a configured budget.
- A structured report records cycle, failure, pressure, recovery and final-state evidence.

## Evidence limitations
This is a deterministic reconstructed-source soak/recovery gate, not a claim of physical Windows/GPU soak validation. It does not prove exact V5.4 source recovery. Exact V5.3.5/V5.4 source ZIP bytes remain unavailable in File Library/GitHub at this milestone; their build-report hashes remain the historical recovery targets.

`llera/stable.json` was not modified and no release was published.
