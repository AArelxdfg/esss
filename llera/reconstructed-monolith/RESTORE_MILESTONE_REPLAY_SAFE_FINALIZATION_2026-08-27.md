# LLera MONOLITH Restore Milestone — Replay-safe verified finalization

## Scope

This milestone hardens reconstructed MONOLITH verified mission finalization against restart/retry replay drift. It does not claim exact historical V5.4 source recovery or physical Windows/GPU validation.

## Problem fixed

The previous finalization receipt SHA-256 included `evaluatedAt`, so the same already-verified mission state could produce a different receipt on each finalize retry. That weakened downstream receipt-based learning idempotency and could create duplicate `verified-finalization` checkpoints after restart/retry.

## Change

- Receipt schema bumped to 2.
- Receipt identity is now a deterministic `stateKey` over mission ID, claim, canonical evidence IDs, material-action evidence bindings, Strict/Adversarial scores, and the durable tool-trace digest.
- Human/debug timestamp `issuedAt` remains in the receipt but is excluded from receipt identity.
- Existing matching `verified-finalization` checkpoint is reused rather than duplicated.
- Evidence ordering is canonicalized and cannot change receipt identity by itself.
- Any real tool-trace mutation changes the receipt identity and prevents stale replay.

## Verification

Deterministic Node regression test PASS:

`replay-safe finalization receipt PASS { stableAcrossTime: true, noDuplicateCheckpoint: true, evidenceOrderCanonical: true, traceMutationInvalidates: true }`

Source SHA-256: `33bf157480cd0b256f37236b169c5282438ad545c54ff16e943ca426dedd45c4`

Test SHA-256: `3c3923b79307902b1a4c894d94025b9c90c6aa7ad276dda2e140e64a7b0b50fb`

## Historical-source status

V5.3.5 expected source ZIP SHA-256 remains `06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097`.

V5.4 expected source ZIP SHA-256 remains `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471`.

The exact source ZIP bytes were not recovered in this run.
