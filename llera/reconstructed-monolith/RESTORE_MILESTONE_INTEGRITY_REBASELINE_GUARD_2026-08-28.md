# LLera MONOLITH OMEGA — Integrity Sentinel Rebaseline Guard

Current baseline: `llera/reconstructed-monolith/` on `main`.

## Restored/hardened behavior

- Sealed Integrity Sentinel baseline entries remain immutable trust anchors after first registration.
- Reasserting the same target bytes is idempotent and does not rewrite role/timestamp trust metadata.
- A changed target can no longer be silently promoted by calling `baseline()` again; it fails closed with `SEALED_REBASELINE_REQUIRES_RELEASE`.
- Changed bytes must enter quarantine/detection and then use the explicit digest-bound `release()` repair flow.
- Repeated checks of the same already-quarantined digest mismatch suppress duplicate incident creation to avoid integrity incident loops/state bloat.
- Path normalization now resolves targets before keying baselines, reducing alias-path duplicate trust anchors.

## Regression evidence

Deterministic Node tests passed locally:

- `sealed-integrity-sentinel.test.js`
- `integrity-rebaseline-guard.test.js`

New regression assertions:

- idempotentBaseline = true
- silentRebaselineBlocked = true
- duplicateIncidentSuppressed = true
- explicitReleaseRequired = true

## Source identity

- `src/sealed-integrity-sentinel.js` SHA-256: `a8a6e3e7e8430b17b4b785eb109c051bdc492dd4617bae1517ac2b6538ffaa26`
- `test/integrity-rebaseline-guard.test.js` SHA-256: `87cdd6bac42000aed6deabe0ae17625e49ea055d2a91b3d7029deca35f672387`
- Delta ZIP SHA-256: `361fbbb366138e42b8f2c4ab8976409176a97eb75d2847d7537dc57c4d545e4c`

GitHub source commit: `c65b82ac7757af6585873b673d35e800e5d6f3a6`.
Regression commit: `636717508a3c75dc9894f395964d5ea978d23aa9`.

## Historical recovery status

Exact V5.3.5/V5.4 source ZIP identities remain known from verified build reports, but exact source archive bytes were not recovered in this run. Searches were repeated across File Library and the user's LLera-related GitHub repositories/history.

No claim is made for exact V5.4, full parity, physical Windows/GPU validation, or Windows-grade final. `llera/stable.json` was not modified and no release was published.
