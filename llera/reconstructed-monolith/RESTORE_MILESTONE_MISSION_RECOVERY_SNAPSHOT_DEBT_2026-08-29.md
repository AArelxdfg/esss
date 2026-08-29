# LLera MONOLITH restore milestone — mission recovery snapshot debt

## Scope
Reconstructed MONOLITH baseline only. Recovery/Native demo shells are not used as the product baseline.

## Restored behavior
- A material tool action that has already executed and been durably traced/checkpointed is no longer surfaced as an exception merely because the follow-up recovery snapshot backend failed.
- Recovery snapshot failure is persisted as a `recovery-snapshot-debt` mission checkpoint.
- While that debt is open, future material actions are fail-closed with `recovery_snapshot_debt_open`.
- Observation/verification tools remain available so verification debt can still be closed.
- `repairRecoverySnapshot()` creates the missing recovery snapshot and persists a `recovery-snapshot-repaired` checkpoint bound to the debt checkpoint.
- Mission finalization now requires both the guarded-tool verifier debt and recovery snapshot debt to be closed.

## Regression
Focused deterministic unit regression: `test/mission-recovery-snapshot-debt.test.js`.

Validated behaviors:
- material action is not retried after snapshot failure
- snapshot debt is durable
- later material actions fail closed
- observations remain usable for verification
- explicit snapshot repair clears the debt

## Evidence / limits
- Source commit: `011766e4a76a9f217560e87c0622debc8ce99140`
- Regression commit: `7f1dbd671dee74fdae5966b41a77c2124f899063`
- Source SHA-256: `b56bf482eb2b537d672f62fa12acb2a3e34b9d045f1934288494314ea2e61756`
- Regression SHA-256: `3265e91b98943f7a7d909259dc693edaead4c2961eef0f0a2644b3cb22030e92`
- Exact historical V5.3.5/V5.4 source bytes were not recovered in this run.
- Physical Windows/GPU validation is not claimed.
- This is not a claim of full V5.4 parity.
- `llera/stable.json` was not modified and no release was published.
