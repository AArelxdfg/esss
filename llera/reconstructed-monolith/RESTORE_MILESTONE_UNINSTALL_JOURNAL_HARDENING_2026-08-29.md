# LLera MONOLITH Restore Milestone — Uninstall Journal Hardening

Date: 2026-08-29
Baseline: `llera/reconstructed-monolith/` on `main`

## Scope

This milestone hardens the reconstructed Windows uninstall transaction without claiming exact historical V5.4 source parity.

### Restored / hardened behavior

- Per-shortcut-scope durable checkpoints for Desktop, Start Menu, Startup and Taskbar cleanup.
- A crash during one shortcut cleanup no longer causes already-completed shortcut scopes to replay on resume.
- An in-progress uninstall intent cannot be overwritten by a new `begin()` call with different data/model retention choices.
- Uninstall journal schema is explicitly validated.
- Unknown or duplicate completed steps are rejected fail-closed.
- Inconsistent aggregate shortcut completion is rejected fail-closed.
- Schema 1 historical journal compatibility is preserved while new writes use schema 2.

## Deterministic verification

PASS:
- interrupted resume
- per-scope shortcut checkpointing
- idempotent completed steps
- independent data/model retention
- stale integration cleanup
- corrupt journal fail-closed
- active intent overwrite rejection
- unknown/duplicate step rejection
- inconsistent shortcut completion rejection
- unsupported schema rejection

## Source identities

- `src/windows-uninstall-transaction.js` SHA-256: `1f8003626e6a4daa3484646c4c4fb124832bb78998a21c70552410bb376f1c6b`
- `test/windows-uninstall-transaction.test.js` SHA-256: `4d308b24513e95b7411884ed050ad21183482940d2678914ee8628e25237b8dd`
- `test/windows-uninstall-journal-hardening.test.js` SHA-256: `892d29159c2a144fd63f66bd43c60d68dee982e9daec74c4912bfc284ba367bb`

## Historical recovery status

Known contracts remain:
- V5.3.5 source ZIP SHA-256: `06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097`
- V5.4 source ZIP SHA-256: `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471`

Exact archive bytes were not recovered in this run.

## Build truth

A full repository checkout / Windows x64 rebuild was attempted after the change, but the build container could not resolve `github.com`. Therefore this milestone does **not** claim a rebuilt full source ZIP, Windows x64 EXE, physical Windows/GPU validation, exact V5.4 parity, or Windows-grade final status.

`llera/stable.json` was not modified and no release was published.
