# LLera MONOLITH Restore — Verified Soak → Watchdog Stability Commit

## Scope
Closes the reconstructed Windows soak/watchdog integration gap where a deterministic soak could pass without committing watchdog stability state.

## Behavior
- Soak report schema bumped to 2.
- `watchdog.markStable()` is called only after every runtime/mission/HOSTGUARD/evidence/watchdog gate passes.
- Failed or incomplete soak never clears crash-loop stability debt.
- Missing `markStable()` support fails closed instead of pretending the soak produced a stable watchdog state.
- A failed watchdog stability-state write blocks the soak result.
- Successful commit is surfaced as `watchdogStabilityCommitted` in both report and gate output.

## Deterministic regression
PASS:
- verifiedSoakClearsDebt
- failedSoakCannotClearDebt
- stabilityWriteFailureBlocksPass

## Source identities
- `src/soak-recovery-gate.js` SHA-256: `e751a4528bdbe9ea69f80e9be207129b8c82f74c4634a1f52930a161dd838236`
- `test/soak-recovery-gate.test.js` SHA-256: `2cd0be046e728c2884b566f536a482286e60f4110a526c71b000eb3056c5d9a3`

## Historical recovery status
Known exact historical source ZIP targets remain:
- V5.3.5: `06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097`
- V5.4: `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471`

Those exact archive bytes were not recovered in this run. This milestone is a reconstructed-source hardening change, not an exact V5.4 claim and not physical Windows/GPU validation.

`llera/stable.json` was not modified and no release was published.
