# LLera MONOLITH Restore — Vision + HOSTGUARD Milestone

Status: reconstructed parity work; not an exact V5.4 source recovery.

## Exact-source recovery status
- V5.3.5 expected source SHA-256: `06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097`
- V5.4 expected source SHA-256: `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471`
- Exact source ZIP bytes were not recovered in this pass.

## Restored behavior
- image/file/screen input normalization with SHA-256 binding
- Vision 4B analysis hook
- Windows OCR fallback/co-processing hook
- Vision single-flight guard
- critical host pressure blocks new Vision load
- critical host pressure unloads active Vision controller
- critical host pressure preempts low-priority inference
- HOST_PRESSURE_EVENT telemetry state
- model-download worker governance: normal 8, elevated 2, critical 1

## Deterministic validation
`vision + hostguard parity PASS { history: 1, pressure: 'critical', workers: 1 }`

## SHA-256
- `src/vision-pipeline.js`: `b30a907f8dda6f41e14df56ec4f3fb748367050b9e318b22ae25a587a44e02a9`
- `src/hostguard.js`: `77a0a06ac1a2c3556957cffa0a680836ff24e64d807267c5590c45fafde0d042`
- `test/vision-hostguard.test.js`: `2b3e643911e12cab541cf59128106442cb58da337b17ddaecf5280c30546c140`

## Claims intentionally not made
- exact V5.4 source recovered
- full 62-tool parity
- physical Windows/GPU/OCR execution validated
- Windows-grade final candidate
- publishable signed release
