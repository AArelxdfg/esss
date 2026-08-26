# LLera MONOLITH restore — atomic recovery + trace compatibility milestone

## What changed

This milestone hardens process-restart recovery across the reconstructed MONOLITH mission, tool-guard and evidence layers.

1. Added `src/recovery-snapshot-coordinator.js`.
   - Binds mission state, persisted toolTrace and evidence ledger into one deterministic SHA-256 recovery envelope.
   - Refuses schema mismatch, mission mismatch, tampered envelope bytes and toolTrace divergence.
   - Restores evidence before restoring tool execution guard state.
2. Hardened `src/tool-surface.js` `ToolExecutionGuard.restore()`.
   - Preserves compatibility with native guard traces (`fingerprint`, `ok`, `observation`).
   - Adds compatibility with MissionEngine persisted traces (`argumentsHash`, `outcome`, `verification`).
   - Reconstructs open verification debt after an interrupted material action.
   - Reconstructs later observation/verification closure of that debt.
   - Failed material actions do not create verification debt.

## Deterministic local tests

PASS:

- `recovery-snapshot-coordinator.test.js`
  - integrityBound
  - verificationDebtRestored
  - evidenceRestored
  - tamperBlocked
- `tool-surface-recovery-compat.test.js`
  - nativeTrace
  - missionTrace
  - interruptedDebtPreserved
  - failedActionNoDebt

## SHA-256

- `recovery-snapshot-coordinator.js`: `b8ddb19ff89388e2689c09a32e7d6f694795e4002e1883829e75f3f1794a9d13`
- `recovery-snapshot-coordinator.test.js`: `0b980090f6e399c7d8674328c36d772c060f20ed8e167ec81490001b96fa4380`
- hardened `tool-surface.js`: `c6e7e2e5502e9839c8c889d97fddda12517d68d203d4f749399f3ef6a17a5992`
- `tool-surface-recovery-compat.test.js`: `271b508abbddedb36a98e0334bb16650e43492b5ca6a6f3444e0e1fb4d16691b`

## Exact-source status

The historical V5.3.5/V5.4 source ZIP bytes were searched again before reconstruction work. The known source hashes remain:

- V5.3.5: `06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097`
- V5.4: `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471`

The exact source ZIP bytes were not recovered in this run. No exact-V5.4 claim is made.

## Artifact boundary

A full reconstructed source ZIP/Windows x64 installer was not emitted in this run because the execution container could not resolve `github.com` for a repository clone and the exact historical build scaffold remains unavailable. Producing a partial archive and naming it a full candidate would be misleading.

`llera/stable.json` was not modified and no release was published.
