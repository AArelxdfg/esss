# Known blockers

1. Historical V5.3.5 and V5.4 source ZIP and installer bytes have now been recovered from File Library and hash-verified against their original build reports. See `HISTORICAL_V535_V54_RECOVERY_2026-09-04.md`.
2. The reconstructed Electron/NSIS Windows x64 build completed and its artifacts are hashed, but behavioral parity against the recovered exact V5.4 source still requires systematic comparison and regression closure.
3. Human GUI, install/uninstall, local GPU/OCR, and soak validation are still required before a Windows-grade final or release claim.
4. Physical Windows app launch, GPU inference, Windows OCR, installer/uninstaller execution, and watchdog soak have not been directly re-verified in this automation environment.
5. No signing material is present, so a publishable signed candidate cannot yet be produced.
