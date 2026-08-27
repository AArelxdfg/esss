# LLera MONOLITH restore milestone — AURORA live backend view-model

Date: 2026-08-27

## What changed

The reconstructed AURORA layer is no longer only a static UI/accessibility contract. `src/aurora-monolith-view-model.js` binds the AURORA surfaces to live MONOLITH state:

- Conversation: llama.cpp runtime readiness, selected/desired model and runtime generation.
- Work: persistent mission state, active mission, interrupted/completed counts and verification-blocked state.
- Activity: recent real operation/audit events.
- Evidence: structured evidence records and target/SHA-256 binding coverage.
- System & Models: runtime endpoint/task state plus HOSTGUARD pressure, worker count, Vision admission and runtime priority.
- Product health: explicit healthy/degraded/critical state derived from runtime state, host pressure, interrupted missions and unbound evidence.

The view-model delegates navigation, responsive behavior, keyboard shortcut handling and accessibility semantics to the existing AURORA UI contract rather than reimplementing appearance logic.

## Verification

Deterministic Node test:

`AURORA backend view-model PASS { liveRuntime: true, persistentWork: true, activity: true, evidenceBindings: true, hostguard: true, accessibilityContract: true }`

Source SHA-256:
`31d2b58dff33643f1ccb0f0dce66e9474cc0a289b340be8cc3f4fc368b903281`

Test SHA-256:
`91303412178586ee8e6cf1b03b066c78a37b524a3ef8a8e707dab70a4a79be93`

## Historical-source status

Exact V5.3.5/V5.4 source archive bytes were searched again. File Library still exposes the verified build reports and expected source hashes, not the source ZIP bytes themselves:

- V5.3.5 source ZIP SHA-256: `06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097`
- V5.4 source ZIP SHA-256: `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471`
- V5.4 historical installer SHA-256: `0304fc6586a0002b2c327ee113dfa9348a220e83668ebbb5aa3c1ef405fd969a`

This milestone is reconstructed behavior parity work. It does not claim exact historical V5.4 source recovery, physical Windows/GPU validation, or a publishable/final Windows candidate. `llera/stable.json` remains untouched and no release is published.
