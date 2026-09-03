# Exact historical V5.3.5 / V5.4 installer + contract recovery — 2026-09-04

This evidence extends the exact source recovery record with direct recovery of the historical Windows installer bytes and an independent rerun of the recovered V5.4 source contract suite. It is provenance/build evidence only. It does **not** claim physical Windows/GPU/OCR/install/uninstall/soak validation and does not promote a release candidate.

## Exact V5.4.0 MONOLITH AURORA UX

- Library source: `/LLera/LLera_V5_4_0_MONOLITH_AURORA_UX_Source.zip`
- Source size: `1448475` bytes
- Source SHA-256: `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471`
- Expected source SHA-256 from build report: `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471`
- Source hash match: **YES**
- Library installer: `/LLera/LLera_V5_4_0_MONOLITH_AURORA_UX_Setup.exe`
- Installer size: `7855104` bytes
- Installer SHA-256: `0304fc6586a0002b2c327ee113dfa9348a220e83668ebbb5aa3c1ef405fd969a`
- Expected installer SHA-256 from build report: `0304fc6586a0002b2c327ee113dfa9348a220e83668ebbb5aa3c1ef405fd969a`
- Installer hash match: **YES**
- Installer file identity in the current Linux inspection environment: `PE32+ executable for MS Windows 6.01 (GUI), x86-64`

### Recovered V5.4 contract suite rerun

Executed with the recovered exact V5.4 source bytes in the current Linux Node environment:

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

Result: **16/16 PASS**.

The rerun confirms the recovered exact archive is internally consistent with its historical contract suite. It does not substitute for physical Windows execution.

## Exact V5.3.5 MONOLITH OMEGA EVIDENCE LEDGER

- Library source: `/LLera/LLera_V5_3_5_MONOLITH_OMEGA_EVIDENCE_LEDGER_Source.zip`
- Source size: `3242430` bytes
- Source SHA-256: `06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097`
- Expected source SHA-256 from build report: `06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097`
- Source hash match: **YES**
- Library installer: `/LLera/LLera_V5_3_5_MONOLITH_OMEGA_EVIDENCE_LEDGER_Setup.exe`
- Installer size: `7845888` bytes
- Installer SHA-256: `1852b9c116fca9c4107e814b556956028d4732f4f04a00f606908d47667b9d2e`
- Expected installer SHA-256 from build report: `1852b9c116fca9c4107e814b556956028d4732f4f04a00f606908d47667b9d2e`
- Installer hash match: **YES**
- Installer file identity in the current Linux inspection environment: `PE32+ executable for MS Windows 6.01 (GUI), x86-64`

## Restoration consequence

Exact historical V5.3.5 and V5.4 **source ZIP and installer EXE bytes are now directly recoverable from File Library and hash-verified against their build reports**. Restoration/parity work should use the recovered exact V5.4 source as the primary historical functional source-of-truth, with V5.3.5 retained as the immediately preceding Evidence Ledger baseline.

Release policy remains unchanged:

- Do not modify `llera/stable.json`.
- Do not publish a GitHub Release.
- Do not claim reconstructed full parity solely from historical recovery.
- Do not claim physical Windows/GPU/OCR/install/uninstall/soak validation without direct runtime evidence.
- Production signing material is still required for a publishable candidate.
