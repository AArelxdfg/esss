# AArel OS Linux Preview status

## Current state

- CURRENT BRANCH: `aarelos-linux-one-day`
- CURRENT HEAD: `055bf7d6f2760902e69e8f6197c0f96698012f5e` before the current checkpoint
- LAST SUCCESSFUL GATE: genuine hybrid ISO rebuilt from the cached rootfs; OVMF accepted the ISO; Casper live autologin reached the Plasma session
- CURRENT FAILED GATE: live environment reaches the AArel desktop
- EXACT ERROR: after 150 seconds with KVM, the 1280x800 runtime screenshot remains on a uniform stock Kubuntu gear surface (`sampled_unique_colors=143`); the hardened visual gate reports `screen appears blank, stuck on a splash, or too uniform`
- WHAT WAS CHANGED: enabled KVM access in CI; made the QEMU gate select the default GRUB entry, prove the UEFI DVD was started, reject firmware/PXE fallback, reject interactive login, and reject uniform splash screens; added a Casper-only SDDM autologin compatibility service; made delivery copies checksum-verified; corrected an emitted `MMonolith` product name
- WHAT STILL NEEDS TO BE DONE: diagnose why Plasma does not progress past the gear surface, reach and capture the AArel desktop, then continue with MMonolith, LLera, Forge, installer, Wine, and installed-system gates
- NEXT COMMAND TO RUN: boot `/home/arelx/aarel-autologin-test.iso`, switch to a TTY with the QEMU monitor (`sendkey ctrl-alt-f3`), and capture `systemctl --user --failed`, `journalctl --user -b`, `systemctl status sddm`, and the `aarel-live-autologin.service` journal
- LATEST WORKFLOW RUN ID: `32820854846`
- ISO STATUS: build succeeds; native reconstructed image is 6,504,306,688 bytes; the previous Desktop copy was partial and is not valid evidence
- QEMU STATUS: OVMF starts the ISO and Casper autologin proceeds; AArel desktop gate still fails
- INSTALLER STATUS: not tested
- MMONOLITH STATUS: not implemented on the Linux production track
- FORGE STATUS: not implemented on the Linux production track
- LLERA STATUS: not implemented on the Linux production track
- VISUAL STATUS: stock Kubuntu gear surface remains dominant; acceptance gate fails

## NEXT AGENT START HERE

Capture the live session/system journal from a QEMU TTY and fix the first Plasma startup failure. Do not weaken the screenshot gate or treat the current gear screen as a desktop pass.
