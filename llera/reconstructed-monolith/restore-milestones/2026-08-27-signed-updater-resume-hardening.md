# LLera MONOLITH — Signed Updater Resume Hardening

Date: 2026-08-27

## Scope

Hardens the reconstructed MONOLITH signed update/download lifecycle without changing `llera/stable.json` or publishing a release.

## Restored/hardened behavior

- A resumed HTTP download now requires a valid `206 Partial Content` response whose `Content-Range` starts at the exact local partial-file offset.
- `Content-Range` total, when present, must equal the signed manifest artifact size.
- The downloader aborts before writing any chunk that would exceed the artifact size committed by the signed manifest.
- Manifest versions are restricted to a path-safe single segment before they are used for download/staging paths.
- Signed artifact URLs must use HTTPS.
- Existing SHA-256 verification, staging integrity verification, activation, progress events and rollback behavior remain preserved.

## Verification

Local deterministic Node tests:

- `signed updater resume hardening PASS`
  - Content-Range binding: PASS
  - signed-size overrun block: PASS
  - path-safe version gate: PASS
  - HTTPS-only artifact gate: PASS
- historical signed updater lifecycle compatibility: PASS

Hashes:

- `src/signed-update-lifecycle.js`: `0b7900b3d79695f09bff4ab0be9ea4f71a597e07e6c7f8371100916a261b7c8d`
- `test/signed-update-lifecycle.test.js`: `06ab9e8a0ce751b17e1869bb90caa4637f1d8bf124acaf4894bea43c0e77ad4d`
- `test/signed-update-resume-hardening.test.js`: `5902f98d45cfe1908f2fcc53c813b92ba8afb93b0a1c97d45b19dbfefb05823b`
- delta ZIP: `0a08663af79d8a30089a1404beaf01ba6d4f08fc2104f80190ad787465c6e302`

## Historical-source recovery status

The exact V5.3.5/V5.4 source bytes were searched again before this change. File Library still exposes the verified V5.4 build report/source SHA-256 contract, not the source ZIP bytes. GitHub exact-hash search returned no V5.3.5 or V5.4 source match.

Expected historical source hashes remain:

- V5.3.5: `06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097`
- V5.4: `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471`

## Build status / truth boundary

A fresh full repository checkout and Windows x64 rebuild were attempted after the meaningful source change, but the execution container could not resolve `github.com`. Therefore no new full reconstructed source ZIP or Windows x64 EXE hash is claimed in this milestone. The local delta archive is not a Windows candidate and is not exact historical V5.4.
