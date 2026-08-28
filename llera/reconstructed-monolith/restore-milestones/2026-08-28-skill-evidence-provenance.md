# LLera MONOLITH OMEGA restore milestone — Skill Evidence Provenance

Date: 2026-08-28
Baseline: current `AArelxdfg/esss` `main`, `llera/reconstructed-monolith/`

## Restored behavior

Outcome Memory / Skill Evolution now fails closed on evidence provenance:

- an outcome is not marked verified unless Strict + Adversarial verification reaches the threshold **and** persisted evidence IDs exist;
- skill-candidate evidence IDs are normalized/deduplicated;
- every skill-candidate evidence ID must come from the verified source mission outcome;
- when the skill verification result supplies its own evidence coverage, every promoted candidate evidence ID must be covered by that verifier result;
- candidate-only trust boundary is preserved (`executable:false`, `approvalRequired:true`).

This closes a reconstructed-source gap where arbitrary evidence IDs could previously be attached to a skill candidate even though they were not part of the verified source outcome.

## Deterministic verification

PASS locally against the exact committed source text:

- existing `test/outcome-memory.test.js`
- new `test/skill-evidence-provenance.test.js`

New regression assertions:

- `evidenceRequiredForVerifiedOutcome`
- `sourceOutcomeBinding`
- `foreignEvidenceRejected`
- `verifierCoverageEnforced`
- `candidateTrustBoundaryPreserved`

Committed source SHA-256: `deab945ec353b4859dc0532b4ffe905679c582acce1ec987168781b113d59863`
Regression test SHA-256: `93aa3dcce769421a1c557041bf5e2a0c7bedae9ff503753aabb244c28033c7a9`

## Historical/source recovery status

Exact V5.3.5/V5.4 source/archive bytes were searched again in File Library and GitHub history. Build reports still identify:

- V5.3.5 source ZIP SHA-256: `06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097`
- V5.4 source ZIP SHA-256: `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471`

The exact historical ZIP bytes remain unavailable in the accessible sources.

## Truth boundary

This milestone does **not** claim exact historical V5.4 bytes, full parity, physical Windows/GPU validation, or Windows-grade final status. `llera/stable.json` is untouched and no release was published.
