# MONOLITH Restore Milestone — Mission Atomic Finalization

Date: 2026-08-28
Baseline: `AArelxdfg/esss` `main`, `llera/reconstructed-monolith/`

## Restored behavior

Work Mode step completion is now committed as one durable state transition rather than two persistence writes. The completed step state, mission current-step clearing, terminal mission status, and `step-complete` checkpoint are constructed before a single persistence call.

This removes the historical crash window where a `step-complete` checkpoint could reach disk while the same step remained persisted as `running`, causing restart recovery to execute an already-completed material action again.

Startup recovery also contains compatibility replay for persisted legacy two-write states: when an interrupted running step already has a matching durable `step-complete` checkpoint, the step is reconstructed as completed and is not re-executed. Interrupted steps without durable completion evidence retain the existing retry behavior.

## Verification

Deterministic regression: `test/mission-atomic-finalization.test.js`

PASS assertions:
- `completeStep()` uses one persistence write.
- step-complete checkpoint reflects the post-completion state.
- legacy crash-window state is replay-safe.
- no-evidence interruption still retries normally.

Local regression output: `MONOLITH mission atomic finalization PASS`.

Source SHA-256: `4d662c881c98b62dc4db0b47b2f92e74a9c35e282bb662c20d136fc76c8bb775`
Regression SHA-256: `5fc0becd1259e03a2ddad5ce503a684a93b69e6c045ce7d17e96c7cd86df6479`
Delta ZIP SHA-256: `cce68c5bd01daef86967dc9a38a88c42ec91443d1c1ad627f9e2f676c4f16995`

## Truth boundary

This is reconstructed current-baseline engineering. It is not a claim that the exact historical V5.4 source bytes have been recovered. No physical Windows/GPU validation is claimed. `llera/stable.json` was not modified and no release was published.
