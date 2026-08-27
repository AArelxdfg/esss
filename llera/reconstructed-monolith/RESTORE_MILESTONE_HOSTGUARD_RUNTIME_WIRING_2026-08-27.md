# LLera MONOLITH restore milestone — HOSTGUARD runtime wiring

Date: 2026-08-27

## Exact-source recovery check

File Library was searched again for the exact V5.3.5 and V5.4 source names and known hashes.

- V5.3.5 expected source SHA-256: `06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097`
- V5.4 expected source SHA-256: `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471`
- Exact source ZIP bytes: **NOT RECOVERED**
- GitHub user-wide code search for both hashes: **0 results**

The verified V5.3.5/V5.4 build reports remain the functional contract. No exact-V5.4 claim is made.

## Restored capability

Added `src/hostguard-runtime-coordinator.js` to connect HOSTGUARD policy to concrete host-protection actions instead of leaving pressure governance as a disconnected policy model.

Behavior now wired:

- pressure-state changes are propagated to `RuntimeLifecycle.applyHostPressure()`;
- CRITICAL pressure therefore reaches the existing low-priority inference preemption path;
- downloader concurrency follows HOSTGUARD policy (`8 -> 2 -> 1` workers);
- Vision admission is blocked during CRITICAL pressure;
- a loaded Vision model is unloaded once per CRITICAL episode rather than repeatedly on every telemetry sample;
- recovery to non-critical pressure rearms Vision admission/unload state;
- runtime process priority is applied through an explicit injectable host hook and is not repeatedly rewritten when unchanged.

This closes the integration gap between the previously restored `HostPressureHysteresis` policy, runtime lifecycle, Vision and downloader controls.

## Verification

Deterministic Node test: `test/hostguard-runtime-coordinator.test.js`

Result:

`HOSTGUARD runtime coordinator PASS`

Verified assertions:

- pressure wiring: PASS
- adaptive download workers: PASS
- low-priority preemption propagation: PASS
- Vision unload latch: PASS
- Vision admission gate: PASS

SHA-256:

- `src/hostguard-runtime-coordinator.js`: `8805feb81723d4abc0b32f6af7483739fe22e5b03ae7b2899da204a79e5ca16c`
- `test/hostguard-runtime-coordinator.test.js`: `087fa038390756297d6321ba24309697bf3997128072e13525d6dd433d5a28fd`
- local verified patch ZIP: `7341f94c56979cfdb8043eb4610150d098d3b4303b8d7c9d04089ed64fba2b1c`

## Artifact boundary

A patch ZIP was built and integrity-tested locally. A full reconstructed source ZIP and Windows x64 EXE were **not** claimed or rebuilt in this run because the execution environment could not resolve `github.com` for repository checkout and the exact historical V5.4 build scaffold/source archive remains unavailable. Producing a partial executable and labeling it as the product would violate the release truth gate.

`llera/stable.json` was not modified. No release was published. Physical Windows/GPU validation is not claimed.
