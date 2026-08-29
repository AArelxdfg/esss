# Runtime transition serialization — 2026-08-29

## Scope

Hardens the reconstructed MONOLITH runtime lifecycle against concurrent lifecycle requests mutating `desiredModel` or launching overlapping llama.cpp runtimes while another start, drain, stop, recovery, or model switch owns the transition.

## Contract basis

The V5.3.2 MONOLITH OMEGA HOSTGUARD contract requires model switching to remain a single-runtime transaction: drain active inference -> stop old runtime -> launch target -> rollback old model if target launch fails.

## Change

- Added a lifecycle transition-ownership preflight before `desiredModel` mutation.
- Rejected concurrent start requests now fail with `RUNTIME_START_IN_PROGRESS` without changing desired model state.
- Rejected requests while the inference-admission transition gate is closed fail with `RUNTIME_TRANSITION_IN_PROGRESS` without changing desired model state.
- Recovery and failed-switch rollback use explicit internal transition ownership so the external fail-closed gate does not break legitimate recovery.
- Existing single-runtime, orphan PID, inference-drain and rollback behavior is preserved.

## Regression

`test/runtime-transition-serialization.test.js` covers:

1. concurrent start rejection does not mutate `desiredModel`;
2. concurrent switch rejection during inference drain does not mutate `desiredModel`;
3. no second backend launch occurs before transition ownership is released;
4. recovery can relaunch under internal ownership;
5. failed target health can still rollback under internal ownership;
6. preferred failed target remains recorded after rollback.

## Exact-byte proof

Final source/test bytes were fetched back from GitHub commit `c4a17b9a41bdea447255d0f17bbc0737bb3d8168` and reconstructed locally.

- `src/runtime-lifecycle.js` Git blob: `7b2f2ffb59624a76d78d2f6b23b9c4e4c8d15307`
- `test/runtime-transition-serialization.test.js` Git blob: `82e4575ba44812ea94c7462ea9265b1f7bd653ce`

Local `git hash-object` matched both GitHub blob IDs exactly. Running the exact reconstructed test bytes against the exact reconstructed source bytes produced:

`MONOLITH runtime transition serialization PASS`

Exit code: `0`.

## CI distinction

A dedicated GitHub Actions runtime restore workflow was added, but the hosted runner job failed before usable step/log output was produced. Therefore the hosted CI run is **not** claimed as PASS. The closure evidence for this milestone is the exact-Git-blob match plus local execution of those exact bytes with exit code 0.

## Non-claims

- This does not establish exact V5.4 source recovery.
- This does not establish physical Windows/GPU validation.
- This does not establish Windows-grade final parity.
- No release was published and `llera/stable.json` was not modified.
