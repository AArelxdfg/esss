# AArel OS Release Candidate Deadline

Target: 2026-08-24 16:00 Europe/Istanbul.

This branch is release-candidate-only until the deadline. Acceptance gates are:

1. Pinned SerenityOS source from `UPSTREAM.lock` checks out exactly.
2. AArel native overlay unit tests pass.
3. Forge and LLeraService compile as native SerenityOS binaries.
4. The x86_64 UEFI raw disk image is produced by Serenity's `uefi-image` target and is never mislabeled as ISO.
5. QEMU/UEFI boot evidence is captured when a runner is available.
6. Forge session plus Terminal/Browser/Files/Settings launch is verified where automation permits.
7. Release package preserves SerenityOS BSD-2-Clause notice and includes SHA-256 evidence.

No Windows-class parity claim is permitted without evidence for the relevant gates.
