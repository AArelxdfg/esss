# HOSTGUARD runtime preemption reconciliation

This reconstructed-MONOLITH milestone closes a runtime/accounting parity gap between host-pressure preemption and inference admission bookkeeping.

## Change

- `RuntimeInferenceCoordinator.reconcileRuntimeAborts()` releases inference-governor slots and local active records after llama.cpp runtime preemption.
- `HostguardRuntimeCoordinator` forwards the exact runtime-aborted inference IDs into that reconciliation path.
- Interactive/high-priority inference remains active while Council/Adversarial low-priority work is preempted under CRITICAL pressure.
- Repeated CRITICAL samples are idempotent and do not double-release or touch the surviving interactive task.

## Verification

Local deterministic Node regression:

`HOSTGUARD preemption reconciliation PASS`

Verified assertions:
- 2 low-priority inferences aborted;
- governor slots released;
- interactive inference preserved;
- repeated CRITICAL sampling is idempotent.

SHA-256:
- `src/runtime-inference-coordinator.js`: `11ee1ea497d36e16785ef6f118fd17e84ba95d3422372e3934d4592767076237`
- `src/hostguard-runtime-coordinator.js`: `2d09190ff590a7f8a6c8960c75d25e48db371dfaaff9ced07a537aef0b5edd79`
- `test/hostguard-preemption-reconciliation.test.js`: `330d40e99edc5195598b161a3815af3ca2b4ac34fef08a66630a193b9d5b695d`

## Truth boundary

This is reconstructed behavior parity, not exact historical V5.4 source recovery, not physical Windows/GPU validation, and not a publishable Windows candidate. `llera/stable.json` is intentionally unchanged.
