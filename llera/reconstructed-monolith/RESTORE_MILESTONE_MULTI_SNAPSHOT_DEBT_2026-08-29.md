# LLera MONOLITH OMEGA Restore Milestone — Multi Recovery Snapshot Debt Hardening

## Scope
Reconstructed MONOLITH baseline only. Recovery/Native demo shells remain deprecated and are not treated as product baseline.

## Restored behavior
- Recovery snapshot debt is now tracked as a set of explicit checkpoint-bound debts instead of a single overwrite-prone value.
- Missing `debtCheckpointId` repair checkpoints fail closed and cannot clear arbitrary debt.
- Unknown repair IDs fail closed.
- A repair clears only the explicitly bound debt; remaining debts continue to block material actions and finalization.
- Existing compatibility field `recoverySnapshotDebt` is preserved, while `recoverySnapshotDebts` and `recoverySnapshotDebtCount` expose full durable state.
- Material actions remain blocked while any recovery snapshot debt is open; observation/verification behavior is unchanged.

## Verification
Focused deterministic regression PASS:
- multipleDebtsTracked
- missingRepairBindingFailsClosed
- unknownRepairBindingFailsClosed
- explicitRepairClearsOnlyBoundDebt
- compatibilitySingleDebtFieldPreserved

Source SHA-256: `fb2ae430cc43a27277c5ef41a896bf27c4a0a29c02429a9e15af188568a37e09`
Regression SHA-256: `eab3fb22a91e72ef099331b681449c66e1628fe0d269b4f1d9b09192326b069b`

## Historical recovery status
Known exact historical source identities remain:
- V5.3.5 source ZIP SHA-256: `06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097`
- V5.4 source ZIP SHA-256: `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471`

Neither exact archive hash is present in current repository code search. Exact historical source/artifact bytes were not recovered in this run.

## Claims intentionally not made
- Not exact V5.4.
- Not full functional parity.
- Not physical Windows/GPU validation.
- No Windows-grade final claim.
- `llera/stable.json` unchanged.
- No release published.
- Full Windows x64 EXE/source ZIP rebuild unavailable because the build runner could not resolve `github.com` for a complete checkout.
