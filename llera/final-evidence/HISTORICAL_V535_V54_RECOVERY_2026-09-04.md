# LLera historical V5.3.5 / V5.4 byte recovery — 2026-09-04

This record captures direct byte-level recovery evidence from the user's File Library. It does **not** claim that the reconstructed tree is itself exact V5.4, nor does it promote `llera/stable.json` or publish a release.

## Recovered V5.3.5 artifacts

- Source: `LLera_V5_3_5_MONOLITH_OMEGA_EVIDENCE_LEDGER_Source.zip`
- Size: 3,242,430 bytes
- SHA-256: `06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097`
- Expected build-report SHA-256: `06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097`
- Hash match: **YES**

- Installer: `LLera_V5_3_5_MONOLITH_OMEGA_EVIDENCE_LEDGER_Setup.exe`
- Size: 7,845,888 bytes
- SHA-256: `1852b9c116fca9c4107e814b556956028d4732f4f04a00f606908d47667b9d2e`
- Expected build-report SHA-256: `1852b9c116fca9c4107e814b556956028d4732f4f04a00f606908d47667b9d2e`
- Hash match: **YES**

## Recovered V5.4 artifacts

- Source: `LLera_V5_4_0_MONOLITH_AURORA_UX_Source.zip`
- Size: 1,448,475 bytes
- SHA-256: `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471`
- Expected build-report SHA-256: `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471`
- Hash match: **YES**

- Installer: `LLera_V5_4_0_MONOLITH_AURORA_UX_Setup.exe`
- Size: 7,855,104 bytes
- SHA-256: `0304fc6586a0002b2c327ee113dfa9348a220e83668ebbb5aa3c1ef405fd969a`
- Expected build-report SHA-256: `0304fc6586a0002b2c327ee113dfa9348a220e83668ebbb5aa3c1ef405fd969a`
- Hash match: **YES**

## V5.4 source archive inspection

The hash-verified V5.4 source ZIP was opened successfully. Its source payload includes the historical application and verification surface, including `payload/app/main.js`, `payload/app/agent.js`, `payload/app/renderer.js`, `payload/app/preload.js`, `payload/app/updater.js`, `payload/app/v3/core.js`, `payload/app/v4/cognition.js`, `payload/app/v5/evolution.js`, installer/uninstaller/watchdog sources, and the V5.4 regression contracts.

## Claim boundary

The exact historical V5.3.5 and V5.4 source/artifact **bytes have now been recovered and hash-verified**. This closes the prior "source bytes not recovered" blocker. It does not by itself prove that the reconstructed implementation has full behavioral parity, has passed physical Windows/GPU/OCR validation, is signed, or is release-ready. Those gates remain separate and must be verified independently.
