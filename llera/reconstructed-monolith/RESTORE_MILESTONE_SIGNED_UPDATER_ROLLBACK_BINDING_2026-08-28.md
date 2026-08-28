# LLera MONOLITH restore — Signed updater rollback binding

This milestone hardens the reconstructed MONOLITH signed updater rollback path.

## Restored / hardened behavior
- Activation now computes SHA-256 for the previous verified current artifact when creating the rollback backup.
- The rollback backup digest is persisted in the durable update journal as `backupSha256`.
- Rollback refuses to proceed when the backup digest is missing.
- Rollback recomputes the backup SHA-256 and fails closed on mismatch before touching the active artifact.
- The temporary rollback copy is also hashed before final atomic replacement.
- A rejected rollback preserves the currently active verified artifact.
- Existing Ed25519 manifest verification, signed artifact size/SHA binding, resumable download, staging integrity, activation and progress behavior remain preserved.

## Deterministic validation
PASS:

`signed updater lifecycle PASS { resume: true, progressEvents: 4, rollback: true, backupBound: true }`

`MONOLITH signed updater rollback binding PASS { backupDigestJournalBound: true, tamperedBackupRejected: true, activeBuildPreservedOnReject: true, unboundLegacyRollbackFailsClosed: true }`

SHA-256:
- `src/signed-update-lifecycle.js`: `c7fdfaf824c74dccfaca372ac311e388b177ee675a8d926db375f37895b07054`
- `test/signed-update-rollback-binding.test.js`: `092772033386e07c7a0522d30d892ffcf6e641806fecc0c12b0f60326e5bafd0`
- delta ZIP: `1b5971a5a6270e70ea2de9c735720345682b1bec098206ae47428e602514231a`

## Exact-source status
Exact V5.3.5/V5.4 source archive bytes remain unavailable. The File Library still records V5.4 source ZIP SHA-256 `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471`; GitHub commit search found no matching historical commit text for either known V5.3.5 or V5.4 source ZIP hash.

This is reconstructed behavior parity work. It is not a claim of exact V5.4 recovery, full parity, physical Windows/GPU validation, or Windows-grade final status.

`llera/stable.json` was not modified and no release was published.
