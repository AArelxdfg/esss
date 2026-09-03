# Exact historical V5.3.5 / V5.4 source recovery — 2026-09-04

This record documents direct recovery of the historical MONOLITH OMEGA source archives from ChatGPT File Library. It is provenance evidence only; it does **not** claim physical Windows/GPU/OCR validation or that the reconstructed product has reached full parity.

## V5.4.0 MONOLITH AURORA UX

- Library file ID: `file_00000000fa0c81f9bd5a8c068875d075`
- Library path: `/LLera/LLera_V5_4_0_MONOLITH_AURORA_UX_Source.zip`
- Materialized byte size: `1448475`
- Direct SHA-256: `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471`
- Expected build-report SHA-256: `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471`
- Hash match: **YES**

The archive was extracted in the current Linux tool environment and its historical JavaScript contract suite was executed with Node `v22.16.0`.

Historical tests re-run from the recovered V5.4 archive:

1. `test_core.js` — PASS
2. `test_hardening.js` — PASS
3. `test_install_layout.js` — PASS
4. `test_ui_surface.js` — PASS
5. `test_v4.js` — PASS
6. `test_v5.js` — PASS
7. `test_v52_vision_models.js` — PASS
8. `test_v531_reliability.js` — PASS
9. `test_v532_hostguard.js` — PASS
10. `test_v533_agent_proof.js` — PASS
11. `test_v534_responsiveness_evidence.js` — PASS
12. `test_v535_evidence_ledger.js` — PASS
13. `test_v53_liveupdate.js` — PASS
14. `test_v540_aurora_ux.js` — PASS
15. `test_v5_integrity.js` — PASS
16. `test_workflow_bridge.js` — PASS

These are historical source/contract test results in the current Linux Node environment. They are **not** a substitute for physical Windows execution.

## V5.3.5 MONOLITH OMEGA EVIDENCE LEDGER

- Library file ID: `file_000000002f2881f488860aa43ef6ff21`
- Library path: `/LLera/LLera_V5_3_5_MONOLITH_OMEGA_EVIDENCE_LEDGER_Source.zip`
- Materialized byte size: `3242430`
- Direct SHA-256: `06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097`
- Expected build-report SHA-256: `06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097`
- Hash match: **YES**

## Recovery consequence

The historical V5.3.5 and V5.4 source ZIP **bytes are now directly recovered and hash-verified**. Future restoration work should use these exact archives as the historical source-of-truth for parity comparison instead of relying only on build reports or reconstructed assumptions.

This evidence does not change release policy:

- `llera/stable.json` must remain unchanged.
- No GitHub Release is authorized.
- Production signing material is still required for publishable release promotion.
- Physical Windows/GPU/OCR/install/uninstall/soak claims still require direct evidence.
