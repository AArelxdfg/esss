# LLera MONOLITH OMEGA Restore Milestone — Vision Backend Recovery

Current reconstructed baseline only. This is not an exact V5.4 source claim.

## Change

`src/vision-pipeline.js` now treats Vision 4B and Windows OCR as independently recoverable backends for applicable image/screen/PDF inputs.

- Vision 4B failure can fall back to Windows OCR instead of aborting the whole input path.
- Windows OCR failure no longer discards a successful Vision 4B result.
- Partial recovery is surfaced as `degraded: true` with structured backend warnings.
- If every applicable backend fails, the operation fails closed with `VISION_BACKENDS_FAILED` and preserves backend failure details.
- HOSTGUARD critical-pressure blocking remains ahead of backend execution.
- Single-flight cleanup remains guaranteed through `finally`.

## Regression gate

`test/vision-backend-recovery.test.js` verifies:

- `visionFailureFallsBackToOcr`
- `ocrFailurePreservesVision`
- `allBackendsFailClosed`
- `hostCriticalPressureStillBlocks`

Local deterministic Node execution: PASS.

## Source hashes from tested delta

- `src/vision-pipeline.js`: `d09acf72ef3bb21d4ca9fc0d23e751d0c531fd46b9ae5d4742e388029959367f`
- `test/vision-backend-recovery.test.js`: `ab47de5b534641e61c172d9a784e3ed4dfe6fbb0154a8ad1a81c322b0bbdd96e`

## Commits

- Source hardening: `009bfcf5ef08fc3049f848f2cb959fcab01f9b0c`
- Regression gate: `60a7afa58d799a358525b187d502a4df749c4258`

## Constraints retained

- No `llera/stable.json` modification.
- No release publication.
- No exact V5.3.5/V5.4 recovery claim.
- No physical Windows/GPU validation claim.
- Full reconstructed checkout/EXE rebuild remains blocked in this runner because `github.com` DNS resolution failed during clone.
