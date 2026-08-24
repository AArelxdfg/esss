# AArel OS — One-Day Linux Pivot

## Goal
Ship a real installable AArel OS developer preview in one day by using Kubuntu 26.04 LTS as the hardware/kernel/userspace foundation while keeping AArel product identity, Forge workflow, LLera services, policy boundaries, branding and release gates.

This is a deliberate product pivot, not a claim that AArel Monolith remains a standalone kernel.

## Foundation
- Base: Kubuntu 26.04 LTS (Ubuntu 26.04 LTS)
- Desktop: KDE Plasma 6.6 / Wayland
- Kernel: Linux 7.0 from the base distribution
- Package stack: APT + Discover; Flatpak enabled for broad desktop app coverage
- Windows compatibility: Wine/Proton layer where supported; unsupported applications must be reported honestly
- Developer baseline: git, curl, bash, build-essential, Python, Node.js, Rust, C/C++, Docker/Podman path

## AArel ownership layer
- AArel OS branding and release identity
- AArel Monolith: system/session orchestration layer, NOT the Linux kernel
- Forge: AArel developer workspace, launcher and developer-first defaults
- LLera: policy-gated native service; no arbitrary shell bypass
- AArel theme: dark visual system, wallpaper, boot splash, login/session defaults, panel/dock layout
- AArel Settings presets and first-run experience
- AArel recovery/update UX built around the base system's proven mechanisms

## One-day build strategy
1. Download and verify official Kubuntu 26.04 LTS ISO.
2. Remaster the ISO reproducibly: unpack ISO + squashfs, chroot into rootfs, apply AArel packages/configuration, repack squashfs and rebuild a genuine hybrid UEFI/BIOS ISO.
3. Remove Kubuntu-facing branding that would confuse product identity while preserving all licenses, package notices and required attribution.
4. Install AArel theme/session defaults, Forge, LLera service, developer tools, Flatpak integration and compatibility packages.
5. Keep KDE services for notifications, networking, Bluetooth, audio, power, multi-monitor, settings, clipboard, search and Wayland instead of rewriting them.
6. Boot the generated ISO in QEMU/OVMF and test live session + installer.
7. Install to a clean virtual disk and verify second boot from the installed disk.
8. Smoke-test Wi-Fi/network UI, audio UI, browser, files, terminal, settings and system monitor where VM support allows.
9. Test a small, explicit Windows application matrix under Wine. Never claim universal EXE compatibility.
10. Produce ISO, SHA256, source overlay, package manifest, license notices, build log, install log and screenshots.

## Time-saving rules
- Do not fork or rebuild the Linux kernel on day one.
- Do not fork KWin/Plasma on day one; theme/configure first, patch only when a visible AArel requirement cannot be achieved through supported extension/config APIs.
- Do not write a new installer on day one; use the base distribution installer and AArel-brand/configure its surrounding experience where licensing allows.
- Do not implement hardware drivers ourselves on day one.
- Do not build every app from source; use signed Ubuntu repositories and Flatpak where appropriate.
- Do not wait for native AArel replacements before shipping; replace components incrementally after the preview exists.

## Visual priority
The first-day build treats visual identity as a release gate, not decoration. The canonical direction is `aarelos-linux/design/VISUAL_DIRECTION.md`; the image must ship AArel Monolith colors, wallpaper, floating Plasma surfaces and Forge terminal defaults from the source overlay.

## 24-hour acceptance gates
The build can be called `AArel OS Linux Preview` only if all of the following pass:
- genuine bootable ISO exists and SHA256 is recorded
- UEFI QEMU live boot reaches AArel desktop
- installer completes onto a fresh virtual disk
- installed system boots independently from that disk
- AArel branding/session is the default after install
- Forge launches
- LLera service starts and policy/kill-switch smoke tests pass
- browser, files, terminal, settings and system monitor launch
- networking and audio services are present and functional in the test environment
- APT package install works
- Flatpak app install path works
- at least one harmless Windows test application is exercised through Wine before any EXE-support statement
- licenses/notices from Ubuntu/Kubuntu/KDE/Linux and redistributed packages are preserved

## Product split
- `AArel OS`: fast production/product track based on Kubuntu 26.04 LTS.
- `AArel Monolith Research`: preserve the independent Serenity-based/native work as a long-term research track. Nothing is deleted.

This split gives AArel a usable system now without throwing away the independent OS work.
