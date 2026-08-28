# LLera MONOLITH OMEGA — Windows Activation Transaction Restore Milestone

Date: 2026-08-29

## Scope

Harden the reconstructed Windows installer activation/rollback path without changing `llera/stable.json` or publishing a release.

## Restored behavior

- Eliminated reliance on renaming `LLera.exe.new` directly over an existing `LLera.exe`.
- Added a durable `activation-replacing` journal state before executable pathname mutation.
- Existing verified executable is displaced to `LLera.exe.activation-old` before the new executable is activated.
- The displaced executable is SHA-256 checked against the recorded previous digest.
- The activation temp and final activated executable are SHA-256 checked against the staged payload digest.
- Interrupted activation restores the previous known-good executable on startup recovery.
- Self-test failure rollback no longer depends on rename-over-existing semantics.
- Missing or digest-invalid rollback material remains fail-closed / repair-required.

## Deterministic regression evidence

`test/windows-activation-transaction.test.js` passed locally with a monkeypatched rename implementation that rejects replacement when the destination already exists, simulating the Windows constraint relevant to this bug.

Verified assertions:

- `noRenameOverExistingDestination`
- `interruptedActivationRestoresKnownGood`
- `selfTestFailureRollbackRestoresKnownGood`
- `activationDigestVerified`

Existing reconstructed regressions also passed against the modified source:

- `windows-packaging-lifecycle.test.js`
- `windows-interrupted-install-recovery.test.js`

## Provenance / non-claims

This is reconstructed MONOLITH source hardening, not recovered exact V5.4 source. Exact V5.3.5/V5.4 source archive bytes were not found in the File Library/GitHub hash search performed for this run.

No physical Windows/GPU validation is claimed. No Windows x64 EXE or release is claimed unless separately produced and hashed. `llera/stable.json` was not modified.
