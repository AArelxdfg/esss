# LLera MONOLITH restore milestone — failed model-switch rollback

Date: 2026-08-28
Baseline: `AArelxdfg/esss` `main` → `llera/reconstructed-monolith/`

## Restored behavior

The current reconstructed runtime lifecycle now matches the verified V5.3.2 HOSTGUARD single-runtime switch contract more closely:

- a model switch stops the currently active runtime before launching the target model;
- if the target process starts but fails its health check, the failed target is cleaned up;
- the last healthy model is relaunched as the single active runtime;
- the user's requested target remains `desiredModel`, so the preference is not silently rewritten;
- switch failure/rollback status is exposed through `lastSwitchFailure` and `switchRollbackCount`;
- if cleanup of the failed target itself fails, automatic rollback is not attempted because single-runtime ownership can no longer be proven.

## Verification

Local deterministic Node tests executed against the exact source content committed in this milestone:

- existing `runtime-lifecycle.test.js`: PASS
- new `runtime-switch-rollback.test.js`: PASS

New regression assertions cover:

- failed target health check;
- cleanup of failed target;
- rollback launch of the previous healthy model;
- restored `ready` state;
- preservation of requested target as `desiredModel`;
- generation advancement on restored runtime;
- explicit rollback transition trace.

Source SHA-256 after modification:
`159e464a3d63c2f661fb17aa3890bc9eba037ea71402eb5d4ab0714b17a6b98a`

New test SHA-256:
`33edfca5c0aa0c83a289588dc16f08962683774df2707e94f2e60477a08ab0f4`

## Historical recovery status

The exact V5.3.5/V5.4 source ZIP bytes were searched again in File Library and GitHub. Only build-report identities remain available in File Library; the exact source bytes were not recovered in this run.

No claim is made that this reconstructed source is byte-identical to V5.4. No physical Windows/GPU validation was performed.

`llera/stable.json` was not modified and no release was published.
