# Runtime inference governor admission bridge

Status: reconstructed MONOLITH behavioral milestone; not exact historical V5.4 and not a Windows publishable candidate.

## Source recovery check

- File Library exact V5.3.5 source SHA-256: `06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097` — build report found, exact source ZIP bytes not found.
- File Library exact V5.4 source SHA-256: `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471` — build report found, exact source ZIP bytes not found.
- GitHub exact V5.4 hash search: 0 matches during this run.

## Improvement

Added `src/runtime-inference-coordinator.js` to connect `HostInferenceGovernor.admit()` to `RuntimeLifecycle.registerInference()`.

Behavior restored/hardened:
- governor admission is enforced before runtime registration;
- Council/Adversarial classes map to low runtime priority so CRITICAL pressure preemption can act on them;
- Interactive maps to high priority and mission work maps to normal priority;
- governor token caps and reasoning profile are carried into the runtime admission record;
- rejected admissions never create runtime tasks;
- runtime registration failure rolls back governor admission, avoiding phantom concurrency consumption;
- completion clears runtime, governor, and coordinator state together.

## Deterministic test

`node test/runtime-inference-coordinator.test.js`

Observed result:

`runtime inference admission bridge PASS`

Checks: governor enforcement, low-priority mapping, CRITICAL class block, token/reasoning profile propagation, rollback on runtime registration failure.

## Hashes

- `src/runtime-inference-coordinator.js`: `9dc4aac1a30c2a6d860e9e2bc73f6bec8398784253722562bd69c2270d2460e5`
- `test/runtime-inference-coordinator.test.js`: `04f19b3828f45b554f7f687c235571baa576bfeec5c7f2a46bf6acce138de386`
- delta patch ZIP: `7fdd464f06127f3004976acbf2de4237bc315f378362e023693f509001e7a7d3`

## Build limitation

A fresh full repository checkout/build was attempted after the source change, but the execution environment could not resolve `github.com`. Therefore no new full reconstructed source ZIP or Windows x64 EXE hash is claimed for this run. `llera/stable.json` remains unchanged and no release is published.
