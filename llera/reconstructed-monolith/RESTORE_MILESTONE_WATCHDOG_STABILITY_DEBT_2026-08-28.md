# LLera MONOLITH OMEGA — Watchdog Stability-Debt Restore Milestone

Date: 2026-08-28

## Scope

Reconstructed MONOLITH baseline only. Recovery/Native demo shells remain deprecated and are not used as the product baseline.

## Restored / hardened behavior

- Crash-loop safe-mode debt is no longer erased by a single clean (`code=0`) process exit.
- Planned exits no longer erase crash-loop safe-mode debt.
- `markStable()` is now the only path that clears crash-loop debt, so a verified stability/soak path can own recovery clearance.
- Corrupt watchdog persistence fails safe into a constrained profile instead of silently resetting crash history.
- Corrupt-state safe mode disables Vision, background missions and automatic model load, and limits inference concurrency to 1.
- Existing Windows install rollback, self-test and keep-user-data uninstall behavior remains preserved by the legacy regression test.

## Deterministic verification

PASS locally in the automation build environment:

- `windows-packaging-lifecycle.test.js`
- `watchdog-stability-debt.test.js`

New regression assertions:

- `cleanExitCannotClearCrashDebt`
- `plannedExitCannotClearCrashDebt`
- `corruptStateFailsSafe`
- `onlyMarkStableClearsDebt`

## Provenance

- Source commit: `635f9b2eb3b7982a83bb080834916bf94b0e1421`
- Regression commit: `bc367d69a49485f4cd948dd781f4c73bcd9d649e`
- Updated source SHA-256: `c458293735ae34b81f78aa56ee2a85e1489ef7c1d50714750ad7f3bd3d01bc89`
- New regression SHA-256: `c8d1d039c0dcb0dd8e81886ddcdc6866bad5ba377c69e0a35f75e09d9c78f2ca`

## Historical recovery status

File Library still verifies V5.3.5 source ZIP SHA-256 `06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097` and V5.4 source ZIP SHA-256 `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471`, but exact historical archive bytes were not recovered in this run. GitHub commit search for both exact hashes returned no match.

## Claims intentionally not made

This milestone does not claim exact V5.4 recovery, full parity, physical Windows/GPU validation, or Windows-grade final readiness. `llera/stable.json` was not modified and no release was published.
