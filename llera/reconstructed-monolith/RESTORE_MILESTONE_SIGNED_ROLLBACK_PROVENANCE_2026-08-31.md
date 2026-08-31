# LLera MONOLITH restore — Signed rollback provenance hardening

This milestone hardens the reconstructed MONOLITH signed updater/rollback lifecycle without changing `llera/stable.json` or publishing a release.

## Concrete source change

`src/signed-update-lifecycle.js` now persists a signed provenance sidecar for the active build and only creates a rollback backup when the previous active bytes are themselves covered by a valid vendor-signed manifest. Rollback now requires both the currently active artifact and the backup artifact to have valid Ed25519 manifest provenance, validates SHA-256 bindings for both, keeps the existing canonical rollback path checks, verifies active/backup bytes before replacement, and restores the previous signed provenance sidecar together with the previous bytes.

This closes the fail-open case where a locally modified rollback journal and replacement backup could previously agree on a new SHA-256 without proving that the backup bytes were an authentic previously signed LLera build.

## GitHub state

- Source hardening commit: `f94f34b4961e606f693248aafcdfb13ced08b67b`
- Current source blob after hardening: `da9cea3067cb7b4787e6f97caa8af055c77508d2`
- Updated path-binding regression commit: `877ffa91e2d4bf593504e2e182d5553b04fea84c`
- Adversarial signed-provenance regression commit: `1a1b698ea35c6aa3380c4e423960498bb77d0e5b`

The adversarial regression covers forged active-manifest provenance, forged backup signatures, journal+backup SHA substitution, legitimate signed rollback, and restoration of the prior provenance sidecar.

## Validation truth

The source and regressions are persisted on GitHub. Repository-exact executable PASS is **not** claimed in this run because the execution container still cannot resolve `github.com`, so the full tree could not be cloned and executed locally. No physical Windows/GPU validation is claimed.

## Exact recovery status

File Library still exposes the verified build contracts rather than the exact V5.3.5/V5.4 source ZIP bytes. Known source ZIP SHA-256 targets remain:

- V5.3.5: `06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097`
- V5.4: `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471`

This remains reconstructed parity work; it is not an exact V5.4/full-parity/Windows-final claim.
