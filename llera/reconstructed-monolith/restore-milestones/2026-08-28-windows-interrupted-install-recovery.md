# LLera MONOLITH restore milestone — interrupted Windows install recovery

Date: 2026-08-28

## Scope

This milestone hardens the reconstructed Windows install/uninstall/watchdog layer against process termination, reboot or power loss between activation and installed-app self-test completion.

## Restored / hardened behavior

- `WindowsInstallLifecycle.recoverInterruptedInstall()` inspects the durable install journal before a new install starts.
- `activated-pending-self-test` is treated as unverified and rolled back to the previous executable.
- Previous executable bytes are SHA-256 sealed before activation and the rollback copy is checked before restoration.
- Corrupt/invalid install journals fail closed instead of allowing an unsafe new mutation.
- `staged` but not activated transactions are abandoned while preserving the currently installed application.
- Stale `.new`, `.rollback` and journal temp files are cleaned deterministically.
- Version strings used in staged filenames are sanitized.
- Uninstall now also clears rollback payloads while preserving user data/models unless explicitly requested otherwise.

## Deterministic validation

Executed locally with Node:

`Windows interrupted-install recovery PASS`

Verified gates:

- crash rollback: PASS
- rollback backup SHA-256 integrity gate: PASS
- corrupt journal fail-closed: PASS
- staged install preserves current executable: PASS

Source SHA-256: `7bae9a4426751dbd0b093876020a10f92fe3c8358b88e0f30f4115deb721ee31`

Test SHA-256: `cd362f7c38f81d05f93e5fa60e7be98d0246d60f9e894a0bad9be3777a1de3fd`

## Historical-source status

Exact V5.3.5/V5.4 source ZIP bytes were searched again before this change and remain unavailable. The verified build-report hashes remain:

- V5.3.5 source ZIP: `06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097`
- V5.4 source ZIP: `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471`

This is reconstructed behavior hardening, not an exact V5.4 source recovery claim.

## Release safety

- `llera/stable.json` was not modified.
- No release was published.
- No physical Windows/GPU validation is claimed.
- A full reconstructed source/Windows x64 rebuild was attempted, but this execution environment could not resolve `github.com`, so no new full-build artifact is claimed.
