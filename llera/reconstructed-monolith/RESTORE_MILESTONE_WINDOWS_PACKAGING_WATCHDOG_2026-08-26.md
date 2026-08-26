# LLera MONOLITH Restore — Windows Packaging + Watchdog Milestone

## Scope
Reconstructed behavioral parity for the Windows install/uninstall/watchdog layer without changing `llera/stable.json` or publishing a release.

## Restored behavior
- SHA-256-gated payload install transaction.
- Staging integrity verification before activation.
- Previous LLera executable backup before replacement.
- Installed-app self-test gate after activation.
- Automatic rollback to previous executable when the self-test fails.
- Explicit install journal states for staged, pending-self-test, verified, rollback and uninstall.
- Uninstall path that preserves user data/models by default and removes them only when explicitly requested.
- Crash-loop watchdog with bounded crash window.
- Safe-mode profile after repeated crashes: Vision disabled, background missions disabled, automatic model loading disabled and inference concurrency reduced to one.
- Stable-run reset path that clears crash-loop state.

## Deterministic test coverage added
`test/windows-packaging-lifecycle.test.js` covers:
1. verified initial install,
2. failed replacement self-test,
3. automatic restoration of the previous executable,
4. three-crash transition to watchdog safe mode,
5. safe-mode resource restrictions,
6. stable-run recovery to normal mode,
7. uninstall with user-data retention.

## Verification boundary
The test source has been committed, but the current execution container failed before Node could execute it. Therefore this milestone does **not** claim a runtime PASS for the new test yet. It also does not claim a rebuilt Windows x64 executable, physical Windows validation, exact V5.4 parity or publishable release status.

## Exact-source status
The File Library search was repeated this run. The expected V5.3.5 source SHA-256 remains `06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097`; the expected V5.4 source SHA-256 remains `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471`. The exact source ZIP bytes were not recovered in this run.
