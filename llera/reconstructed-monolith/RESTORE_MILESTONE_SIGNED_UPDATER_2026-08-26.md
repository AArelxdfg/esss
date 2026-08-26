# LLera MONOLITH restore — Signed updater milestone

This milestone restores the signed updater/download/progress/install/rollback lifecycle on the reconstructed MONOLITH baseline.

## Restored behavior
- Ed25519 signed manifest verification before update acceptance.
- Canonical manifest serialization to prevent signature ambiguity.
- Artifact size and SHA-256 contract validation.
- HTTP Range resume support with safe full-download fallback when a server ignores Range.
- Live download/verified/activated/rolled-back progress events.
- Staged artifact integrity verification before activation.
- Previous-current backup before activation.
- Atomic file replacement through temporary paths.
- Durable update journal for staged/activated/rolled-back state.
- Explicit rollback restoring the prior verified artifact.

## Deterministic validation
Executed under Node in the restore environment:

`signed updater lifecycle PASS { resume: true, progressEvents: 4, rollback: true }`

Node syntax checks passed for source and test.

SHA-256:
- `src/signed-update-lifecycle.js`: `dba15c35f32989b95f178dff0a1944c02d1bbd132f8e43362403f7ac5d688069`
- `test/signed-update-lifecycle.test.js`: `46b764a4968ba314a1fe92e9e4e18b5dfc145e470c6cefde0c5ca85026ad7a21`

## Exact-source status
Exact V5.3.5/V5.4 source ZIP bytes were searched again before reconstruction work. They remain unavailable. V5.4's historical build report still records source SHA-256 `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471`.

This is reconstructed behavior parity work. It is not a claim of exact V5.4 source recovery, full product parity, physical Windows/GPU validation, or publishable Windows-grade final status.

`llera/stable.json` remains untouched and no release is published.
