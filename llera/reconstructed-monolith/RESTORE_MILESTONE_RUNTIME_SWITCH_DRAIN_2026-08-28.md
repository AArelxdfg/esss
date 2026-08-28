# LLera MONOLITH Restore Milestone — Runtime model-switch inference drain

## Scope

This milestone hardens the current unified reconstructed MONOLITH baseline at `AArelxdfg/esss/main -> llera/reconstructed-monolith/`. Recovery/Native demo shells are not used as the product baseline. This does not claim exact historical V5.4 source recovery or physical Windows/GPU validation.

## Contract restored

The verified V5.3.2 HOSTGUARD build report requires single-runtime model switching in this order:

1. drain active inference,
2. stop the old llama.cpp runtime,
3. launch the target model,
4. rollback the previous model if target launch fails.

The current reconstructed runtime already enforced stop-before-start and failed-target rollback, but it cleared active inference records during stop without explicitly draining every active request first.

## Change

- Added deterministic `drainActiveInference(reason)` to `src/runtime-lifecycle.js`.
- Model switching now aborts/drains every active inference task before stopping the old runtime.
- Drain order is stable by start time and inference ID.
- A failed drain is fail-safe: the old healthy runtime remains running, the failed task remains registered, and the target runtime is not launched.
- Existing single-runtime target-start rollback behavior remains intact.

## Verification

Deterministic Node regression PASS:

`runtime switch drain PASS { drainBeforeStop: true, allPrioritiesDrained: true, failedDrainKeepsOldRuntime: true, singleRuntime: true }`

Source SHA-256: `eae0f108ddca8a98823717fe17a332436280dd83a66f7abd90600cef055c117d`

Regression test SHA-256: `74d9fd7d95c38c08a095d02fdf4cc71f1aee63cae8ac635afb9228001d63cad1`

## Exact historical-source status

V5.3.5 expected source ZIP SHA-256 remains `06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097`.

V5.4 expected source ZIP SHA-256 remains `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471`.

File Library still exposes the verified build reports but not the corresponding exact source ZIP bytes. Exact-hash searches in the current GitHub repository returned no matching source artifact in this run.

## Build limitation

The execution container still cannot resolve `github.com` for a full checkout, so a trustworthy full reconstructed source ZIP / Windows x64 EXE rebuild was not produced in this run. `llera/stable.json` was not modified and no release was published.
