# AArel MMonolith OS release status

## 2026-08-25 final-release continuation

- CURRENT HEAD AT SPRINT START: `683682f2b6b0a8a2fc6141d88f3635e61073b215`
- LAST PASS GATE: official 26.04 archive base SHA-256 verification (`487f87faaf547ea30e0aba4d5b53346292571256b25333a978db1692bcee9dd2`)
- FIRST FAIL GATE: new archive base extraction initially expected legacy `/casper/filesystem.squashfs`
- EXACT ERROR: `Cannot determine attributes of (ISO) source file '/casper/filesystem.squashfs': No such file or directory`
- ROOT CAUSE/FIX: 26.04 desktop media uses layered `/casper/minimal.squashfs`; builder now replaces and fully verifies that actual payload path
- ACTIVE GATE: first clean no-flavour-base build is installing the explicitly selected KDE/AArel package set in isolated build `20260825T190550Z-335`
- WORKFLOW RUN ID: local release build (no GitHub run created yet)
- NEXT AGENT START HERE: poll WSL build session/process; if it exited, read the first exact error. The build is rooted at `/root/.cache/aarelos-linux/builds/20260825T190550Z-335`. Do not reuse or mutate that rootfs while compression is active.

## Current state

- CURRENT BRANCH: `aarelos-linux-one-day`
- CURRENT HEAD: `c8717ccc119069c4d81a0fa3c37d26cb5a013d0c`
- LAST SUCCESSFUL GATE: final clean-disk install from the release ISO, ISO-free UEFI reboot, SDDM login, automatic AArel desktop, Forge launch, MMonolith/LLera/Flathub active
- CURRENT FAILED GATE: none in the locally executable acceptance matrix
- EXACT ERROR: none; final GitHub workflows are queued behind the self-hosted runner rather than failed
- WHAT WAS CHANGED: pinned the official base; hardened reproducible hybrid ISO generation; fixed live boot, Calamares source signing and deb822 automirror; added MMonolith, policy-gated LLera, Forge, Flathub retry, AArel visual/session defaults; removed legacy parallel-module boot stall and upstream onboarding/desktop clutter
- WHAT STILL NEEDS TO BE DONE: allow the already-queued final GitHub workflows to drain; physical Bluetooth and multi-monitor behavior remain hardware validation, not VM claims
- NEXT COMMAND TO RUN: `git status --short && git rev-parse HEAD`; then inspect workflow `32863925613` when the self-hosted runner starts it
- LATEST WORKFLOW RUN ID: `32863925613` (AArel OS Linux ISO Build, queued for `c8717cc`); final visual runs `32863923328` and `32863929924` are also queued
- ISO STATUS: PASS; `AArelOS-Linux-Preview-amd64.iso`, 6,974,531,584 bytes, SHA-256 `2f589da1cde25e4189eecfb7d64d98d16b26e0b59c6834aee7d41c566c0caaf4`
- QEMU STATUS: PASS; genuine hybrid ISO exposes BIOS and UEFI El Torito boot images; OVMF live boot reaches the AArel desktop
- INSTALLER STATUS: PASS; seventh clean 40 GiB qcow2 installation reached Calamares “All done”, then booted without the ISO and reached the branded desktop
- MMONOLITH STATUS: PASS; installed and active; health/status smoke gate passed
- FORGE STATUS: PASS; installed launcher opens the AArel Forge terminal and reports real MMonolith/LLera state
- LLERA STATUS: PASS; installed and active; health, policy refusal and real kill-switch smoke gates passed
- VISUAL STATUS: PASS for previous preview scope; AArel dark wallpaper, panel, typography/icon defaults and Forge profile apply automatically; upstream Welcome Center and seeded web links are absent
- PACKAGE STATUS: PASS; network ping, Ubuntu security repositories, `apt-get update`, and an actual `sl` package install succeeded
- FLATPAK STATUS: PASS; Flatpak 1.16.0 is installed and the `flathub` system remote is active
- WINE STATUS: PASS; Wine 10.0 is installed and Wine64 Notepad launched; no universal EXE compatibility is claimed
- APP STATUS: PASS; Terminal, Firefox, Dolphin, System Settings, Plasma System Monitor, and Forge launched in the installed VM
- AUDIO STATUS: PASS within VM limits; PipeWire 1.6.2 and WirePlumber are active; QEMU exposes a dummy output because the test VM intentionally used a no-audio backend
- LICENSE STATUS: PASS; derivative foundation notice is shipped and 3,032 package copyright files remain under `/usr/share/doc`

## Evidence

- Final ISO SHA-256: `/home/arelx/aarel-runtime.iso.sha256`
- Final installed desktop screenshot: `work/installed7-desktop2.png`
- Final service/Flathub screenshot: `work/installed7-gates2.png`
- Final Forge screenshot: `work/installed7-forge.png`
- Browser, Files, Settings and System Monitor screenshots: `work/installed7-browser2.png`, `work/installed7-files2.png`, `work/installed7-settings3.png`, `work/installed7-monitor3.png`
- Installer result: seventh clean install showed Calamares “All done” before ISO-free reboot

## NEXT AGENT START HERE

No local product failure remains. Monitor queued workflow `32863925613`; if it reports a new reproducible failure, read the first exact error and patch from `c8717cc`. Do not regress the passing clean-install, ISO-free boot, first-session visual, MMonolith, LLera, Forge, Flathub, APT, Wine, and app gates.
