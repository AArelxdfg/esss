# AArel OS Windows-Class Gates

AArel OS may only claim Windows-class maturity after these gates are demonstrated on CI and real hardware. This file is intentionally stricter than a feature checklist.

## 1. Boot, install and recovery
- UEFI boot on QEMU and at least three physical machines.
- Installer can partition, install, create a user and boot without manual shell steps.
- A/B or generation-based update rollback.
- Recovery environment can repair boot, restore the previous generation and export logs.

## 2. Desktop and multitasking
- AArel Monolith desktop is the default session shell.
- Search/application launcher, task switching, notifications, clipboard, settings and system monitor are native and stable.
- Smooth window move/resize/minimize/maximize/fullscreen and multi-workspace behavior.
- Multi-monitor, HiDPI and keyboard/mouse settings persist across reboot.

## 3. Application platform
- Stable process spawn and IPC contracts.
- Package install/remove/update path with signed metadata.
- POSIX developer baseline: bash, curl, git plus documented Python/Node/Rust/C/C++ support status.
- Win32 compatibility is a gated compatibility layer or VM fallback; no compatibility claim without executable test evidence.

## 4. Hardware qualification
- NVMe/SATA storage, common USB HID, xHCI, audio, wired network and at least one common Wi-Fi path.
- Intel/AMD graphics acceleration status tracked separately from framebuffer fallback.
- Suspend/resume, shutdown, reboot, clock and battery behavior qualified where hardware supports it.

## 5. Security
- User/process isolation and pointer validation.
- W^X/NX and platform hardening available where CPU support exists.
- Capability/sandbox boundaries for privileged services.
- Signed update metadata, rollback protection and auditable LLera action policy.

## 6. Reliability
- 24-hour interactive soak test.
- Repeated boot/install/update/rollback loops.
- Storage and IPC fuzzing for critical parsers and privilege boundaries.
- Crash reporting and recovery do not corrupt the active user session.

## 7. LLera system intelligence
- LLera remains a policy-gated native service.
- Model/backend failures cannot execute arbitrary shell commands or bypass capability policy.
- Kill switch and audit trail are tested across reboot/session restart.

## Release rule
A successful boot screenshot is a milestone, not Windows-class parity. The Windows-class label is reserved for a release where the above gates have reproducible evidence and the unsupported areas are explicitly documented.
