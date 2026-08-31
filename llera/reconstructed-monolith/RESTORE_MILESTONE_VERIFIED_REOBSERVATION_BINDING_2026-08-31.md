# LLera MONOLITH restore milestone — verified material re-observation binding

Date: 2026-08-31
Branch: `llera-reliability-audit-2026-08-29`

## Restored / hardened behavior

The verified mission finalization boundary no longer accepts evidence attached directly to a material action as sufficient proof that the action's effect was independently observed.

For every successful material action, finalization now requires a later successful non-material verification/observation trace before the next successful material action. That trace must bind to the material action by one of the same fail-closed mechanisms used by the ToolExecutionGuard:

1. exact `verifiesFingerprint`/equivalent -> material `argumentsHash`/fingerprint binding, or
2. historical compatibility path: equal non-empty verification scope when no explicit verifier fingerprint is present.

Cross-step verification, wrong explicit fingerprints, direct action-only evidence, evidence after a later material action, and empty verification evidence IDs do not satisfy the finalization evidence continuity gate.

The immutable verified-finalization receipt keeps its schema-2 shape and therefore avoids an unnecessary receipt format break; its existing `materialBindings` now derive only from independently re-observed evidence.

## Regression coverage

Updated:
- `test/verified-mission-finalizer.test.js`
- `test/material-evidence-continuity.test.js`

The Reliability Audit workflow now includes both tests in the Category 1 gate.

Coverage includes:
- open verification debt rejection
- independent post-action observation requirement
- exact material fingerprint binding
- compatible target-scope binding for restored historical traces
- direct action-evidence bypass rejection
- wrong fingerprint rejection
- cross-step rejection
- cross-material evidence leak rejection
- enriched V5.3.5-style evidence record use
- Strict + Adversarial verifier rejection path
- verified-finalization receipt evidence binding

## Source commits

- `f1932f3a9c9e27f37a9bc8cbe0bc6019ea08e15c` — finalizer source hardening
- `45a9fdd4279ba37aa0fbd02312f85d4868782d1f` — finalizer regression update
- `048561cdda3a0ca35f1140da127c1c881f34643f` — material evidence continuity adversarial regression
- `b98bde4255ef8eb6ed06cacb1c7be777190ce798` — CI gate inclusion
- `280e9cf4c9d2b5f53a6ec515a290692a863a0475` — enriched evidence regression alignment

## Verification truth / remaining limits

GitHub Actions run `33432510711` failed before any job step was exposed (`steps: null`). This environment also cannot clone GitHub through the local container because DNS/network access is unavailable. Therefore this milestone is source + regression hardened and persisted, but a fresh runtime PASS is **not claimed** yet.

No `llera/stable.json` modification was made and no release was published.

The exact historical V5.3.5/V5.4 source ZIP bytes remain unrecovered in this run. The File Library still provides the verified historical contracts/hashes, not the source bytes themselves.

No claim is made here for exact V5.4 parity, physical Windows/GPU execution, Windows-grade final readiness, or a newly rebuilt Windows installer/source ZIP.
