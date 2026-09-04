# LLera MONOLITH OMEGA — Restoration Sprint Closeout

Date: 2026-09-04
Branch: `llera-final-build-reconstruction-2026-09-01`
Baseline HEAD at closeout start: `70609a91799d702332997c643b4cf66078447c9c`

## Sprint outcome

The restoration sprint is closed as a source/product-behavior restoration milestone. Recovery/Native demo shells are deprecated and are not the product baseline. The reconstruction is anchored to the verified MONOLITH OMEGA V5.3.5/V5.4 contracts and the MONOLITH Workspace visual target.

## Verified historical contracts

- V5.3.5 installer SHA-256: `1852b9c116fca9c4107e814b556956028d4732f4f04a00f606908d47667b9d2e`
- V5.3.5 source ZIP SHA-256: `06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097`
- V5.4 installer SHA-256: `0304fc6586a0002b2c327ee113dfa9348a220e83668ebbb5aa3c1ef405fd969a`
- V5.4 source ZIP SHA-256: `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471`
- V5.4 historical build contract records 16/16 JavaScript regression/contract tests PASS, Node syntax PASS, Go Windows vet PASS, Windows installer cross-build PASS, and source ZIP generation PASS.
- Historical reports explicitly do not claim physical Windows/GPU execution in the Linux build environment.

## Restored product-behavior areas

The reconstruction branch contains concrete restoration/hardening work across the requested parity sequence, including:

1. local llama.cpp runtime/model lifecycle and protocol recovery
2. persistent Conversation/Work Mode missions and checkpoints
3. historical agent tool surface toward the 62-tool contract
4. anti-loop/material-action verification boundaries
5. structured Evidence Ledger identity/target/SHA-256 bindings
6. Strict + Adversarial verifier isolation and fail-closed behavior
7. Outcome Memory, Skill Evolution, Failure Doctrine, Integrity Sentinel
8. Vision/image/file/screen and Windows OCR boundaries
9. HOSTGUARD pressure governance and adaptive inference preemption
10. signed updater/download/install/rollback hardening
11. AURORA/MONOLITH UI behavior/accessibility restoration
12. Windows installer/uninstaller/watchdog acceptance infrastructure

## Windows build gate

Workflow: `.github/workflows/llera-monolith-reconstructed-windows.yml`

The current workflow is configured to run regression tests, package the reconstructed source ZIP, build Windows x64 unpacked + NSIS outputs, hash all artifacts, and upload build evidence.

The latest Windows runner attempts fail before any workflow step is assigned/executed (`steps: null` / no runner execution). A manual rerun on 2026-09-04 reproduced the same pre-step failure. Therefore no fresh reconstructed Windows artifact SHA-256 is recorded here.

This is an external CI runner/build-execution blocker, not evidence that the application test/build commands themselves failed.

## Claim boundary

This closeout does NOT claim:

- byte-identical reconstructed V5.4
- full physical Windows/GPU validation
- a newly verified Windows-grade final installer
- a publishable signed release candidate

`llera/stable.json` must remain unchanged and no release should be published until a fresh Windows build/acceptance run produces real artifacts and signing requirements are satisfied.

## Sprint status

**RESTORATION SPRINT: CLOSED**

**PRODUCT SOURCE/PARITY WORK: RESTORED TO THE CURRENT VERIFIED RECONSTRUCTION MILESTONE**

**FINAL WINDOWS ARTIFACT GATE: BLOCKED EXTERNALLY BY RUNNER EXECUTION; NOT WAIVED**
