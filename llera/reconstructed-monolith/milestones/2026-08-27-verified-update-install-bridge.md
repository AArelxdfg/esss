# LLera MONOLITH — Verified Update → Windows Install Bridge

## Scope
This milestone wires the reconstructed signed update lifecycle into the reconstructed Windows install/self-test/rollback lifecycle without changing `llera/stable.json` or publishing a release.

## Behavior restored
- Signed manifest verification remains the first gate.
- Watchdog safe mode blocks update mutation before download/install work.
- Downloaded artifact SHA-256 must match the signed manifest before install.
- Staged artifact is passed into the Windows install transaction with the same signed digest.
- Windows installed-app self-test remains mandatory before the update is considered verified.
- A failed self-test surfaces rollback state rather than being reported as a successful update.
- Successful verified install marks the crash-loop watchdog stable.

## Deterministic test
`verified update/install bridge PASS`

Validated gates:
- signedManifestGate
- digestContinuity
- windowsSelfTestGate
- rollbackSurfaced
- watchdogSafeModeGate

## Source hashes
- `src/verified-update-install-coordinator.js`: `3ed8629f34748829568f7201f66238c5ffb7ae863f90ab27ab7ada673dbae12f`
- `test/verified-update-install-coordinator.test.js`: `1006eb878bb830da86a91b69a1f11223c35e261b65572581c14f2b391e150dd4`

## Historical-source status
Exact V5.3.5/V5.4 source ZIP bytes were searched again and were not recovered. Verified historical hashes remain:
- V5.3.5 source ZIP: `06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097`
- V5.4 source ZIP: `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471`

This is reconstructed behavioral parity work, not a claim of exact V5.4 source, physical Windows/GPU validation, or Windows-grade final status.
