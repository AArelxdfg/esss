# 2026-08-27 — Vision Runtime Adapter milestone

This milestone connects the reconstructed MONOLITH Vision pipeline to product-style runtime inputs without claiming exact historical V5.4 source recovery.

## Restored behavior
- Image input from filesystem path or in-memory bytes.
- File/PDF input through the same Vision pipeline.
- Desktop screen capture adapter path.
- Windows OCR backend hook for image/file/screen inputs.
- HOSTGUARD pressure admission: CRITICAL pressure blocks new Vision analysis.
- Existing Vision single-flight and SHA-256 input binding remain in the underlying pipeline.

## Deterministic test
`Vision runtime adapter PASS { imagePath: true, filePdf: true, screenCapture: true, windowsOcr: true, hostguardAdmission: true }`

## SHA-256
- `src/vision-runtime-adapter.js`: `ed1ebeb5c434616bf1c7d2c898c17e7db1bf1a8a07953afc070837560ab44272`
- `test/vision-runtime-adapter.test.js`: `db98875e6b119ed65d6e36382ff290beafe6b85b52532560fb2703cba7a48129`
- delta patch ZIP: `f676840f58c9e9f6203dec3377c2370c9ba8e5bd4bee2acd0f102abd66fdf068`

## Historical source recovery status
- V5.3.5 expected source SHA-256: `06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097` — exact source ZIP bytes not recovered.
- V5.4 expected source SHA-256: `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471` — exact source ZIP bytes not recovered.

No `llera/stable.json` change and no release publication.
