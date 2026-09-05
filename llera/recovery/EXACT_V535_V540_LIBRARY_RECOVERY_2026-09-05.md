# LLera exact historical artifact recovery — 2026-09-05

This record documents direct recovery of the historical V5.3.5 and V5.4 artifact bytes from the user's ChatGPT File Library. These are the exact historical files whose SHA-256 values match the previously recorded build reports.

## Recovered exact bytes

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `LLera_V5_3_5_MONOLITH_OMEGA_EVIDENCE_LEDGER_Setup.exe` | 7,845,888 | `1852b9c116fca9c4107e814b556956028d4732f4f04a00f606908d47667b9d2e` |
| `LLera_V5_3_5_MONOLITH_OMEGA_EVIDENCE_LEDGER_Source.zip` | 3,242,430 | `06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097` |
| `LLera_V5_4_0_MONOLITH_AURORA_UX_Setup.exe` | 7,855,104 | `0304fc6586a0002b2c327ee113dfa9348a220e83668ebbb5aa3c1ef405fd969a` |
| `LLera_V5_4_0_MONOLITH_AURORA_UX_Source.zip` | 1,448,475 | `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471` |

The V5.3.5 source ZIP contains 62 ZIP entries. The V5.4 source ZIP contains 61 ZIP entries.

## Recovery status

- Exact historical V5.3.5 source bytes: **RECOVERED**
- Exact historical V5.3.5 installer bytes: **RECOVERED**
- Exact historical V5.4 source bytes: **RECOVERED**
- Exact historical V5.4 installer bytes: **RECOVERED**
- Hashes match the previously recorded build-report contracts: **YES**

## Integration rule

Do not replace the newer reconstructed source blindly. Treat the recovered source ZIPs as historical authorities for parity comparison and selectively reconcile historical behavior into the newer reconstruction while preserving later hardened behavior.

This record does **not** by itself claim that the current reconstructed branch is exact V5.4, fully parity-complete, physically Windows-validated, signed, or release-ready.

`llera/stable.json` was not modified and no GitHub Release was published by this recovery step.
