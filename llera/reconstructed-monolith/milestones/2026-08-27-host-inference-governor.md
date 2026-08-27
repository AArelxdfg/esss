# HOSTGUARD inference governor restore — 2026-08-27

## Historical contract

The verified V5.3.5 Evidence Ledger build report states that the existing host concurrency/token/reasoning governor remains active while CRITICAL pressure adds adaptive low-priority preemption for Model Council and adversarial verification workloads.

## Restored behavior

- Added `src/host-inference-governor.js`.
- Added pressure-aware global and per-class concurrency admission for interactive, mission, council and adversarial inference.
- Added pressure-aware token ceilings.
- Added pressure-aware reasoning profiles.
- CRITICAL pressure blocks new council/adversarial admissions and exposes active council/adversarial tasks as preemption candidates.
- Updated `src/hostguard-runtime-coordinator.js` so HOSTGUARD pressure transitions also update the inference governor while preserving the existing runtime-pressure, downloader-worker, Vision-unload and BelowNormal-priority paths.
- Added `test/host-inference-governor.test.js` covering concurrency, token caps, reasoning profiles, CRITICAL council/adversarial blocking and HOSTGUARD runtime wiring.

## Verification status

The source and regression test are persisted on `main`. During this automation run the local execution container returned a transient tool-rate-limit error before Node execution could be completed, so no new runtime PASS claim is made for this test in this milestone.

## Exact-source status

The exact V5.3.5/V5.4 source ZIP bytes remain unavailable. Known historical hashes remain:

- V5.3.5 source ZIP: `06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097`
- V5.4 source ZIP: `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471`

The V5.4 exact hash search in the current LLera GitHub repository returned no matching code result during this run.

## Non-claims

This milestone does not claim exact V5.4 recovery, full parity, a publishable Windows candidate, physical Windows/GPU validation, or Windows-grade final status. `llera/stable.json` was not modified and no release was published.
