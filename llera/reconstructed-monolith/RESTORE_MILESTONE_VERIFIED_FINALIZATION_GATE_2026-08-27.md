# LLera MONOLITH restore — verified finalization gate

Date: 2026-08-27

## Restored behavior

A completed mission can no longer be treated as publishable solely because all steps reached `completed`.

`src/verified-mission-finalizer.js` now requires all of the following before returning `publishable: true`:

- durable MissionToolCoordinator state reports no open material-action verification debt;
- every successful material tool trace has at least one evidence ID;
- every referenced evidence ID exists in the mission-scoped Evidence Ledger;
- Evidence Ledger entries retain target + SHA-256 bindings accepted by DualVerifier;
- Strict verifier score meets the existing 0.62 threshold;
- Adversarial verifier score independently meets the existing 0.62 threshold;
- finalization creates a SHA-256-bound receipt containing mission, claim, evidence IDs, verifier scores and a toolTrace digest;
- successful finalization is persisted as a `verified-finalization` mission checkpoint.

This closes a parity gap where a mission could be internally `completed` while final-output evidence/verifier gates were still only separate modules.

## Deterministic validation

Local Node test result:

`verified mission finalizer PASS { debtGate: true, materialEvidenceGate: true, dualVerifierGate: true, receiptBound: true }`

SHA-256:

- `src/verified-mission-finalizer.js`: `a34ebd49b55938dba37c695c70a407d325a9270f6e76e622d1e90f601b407ad5`
- `test/verified-mission-finalizer.test.js`: `71def71a37333a4e0ab9fa7cd2c471c7c2e84a25efe5c0be574ae9488fe1422f`

## Exact-source recovery status

File Library was searched again for the V5.3.5 and V5.4 source ZIP names and known SHA-256 values. Only the build reports/hashes were recovered; exact source ZIP bytes remain unavailable.

Expected historical source hashes remain:

- V5.3.5: `06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097`
- V5.4: `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471`

GitHub code search in `AArelxdfg/esss` returned no exact-hash matches for either source hash in this run.

## Truth boundary

This milestone is reconstructed behavior parity, not recovery of exact V5.4 source, not physical Windows/GPU validation, and not a Windows-grade final candidate. `llera/stable.json` was not modified and no release was published.
