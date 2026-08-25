#!/usr/bin/env bash
set -euo pipefail

ROOTFS=${1:?rootfs path required}
BASE_ISO=${2:?base ISO required}
OUT_ISO=${3:?output ISO required}
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="${AAREL_REPACK_WORK:-$(dirname "$ROOTFS")/verified-repack}"

install -D -m 0644 "$SOURCE_DIR/overlay/usr/share/wayland-sessions/aarel.desktop" \
  "$ROOTFS/usr/share/wayland-sessions/aarel.desktop"
install -m 0755 "$SOURCE_DIR/overlay/usr/lib/aarel/live-autologin.sh" \
  "$ROOTFS/usr/lib/aarel/live-autologin.sh"
install -D -m 0644 "$SOURCE_DIR/overlay/etc/sddm.conf.d/10-aarel-wayland.conf" \
  "$ROOTFS/etc/sddm.conf.d/10-aarel-wayland.conf"
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"
chroot "$ROOTFS" dpkg-query -W --showformat='${Package} ${Version}\n' | sort > "$WORK_DIR/filesystem.manifest"
du -sx --block-size=1 "$ROOTFS" | cut -f1 > "$WORK_DIR/filesystem.size"
mksquashfs "$ROOTFS" "$WORK_DIR/filesystem.squashfs" -noappend -comp zstd \
  -Xcompression-level 15 -processors "$(nproc)"
unsquashfs -d "$WORK_DIR/pre-test" "$WORK_DIR/filesystem.squashfs"
test -f "$WORK_DIR/pre-test/usr/share/wayland-sessions/aarel.desktop"
xorriso -indev "$BASE_ISO" -outdev "$OUT_ISO.tmp" -overwrite on \
  -volid AAREL_MMONOLITH \
  -map "$WORK_DIR/filesystem.squashfs" /casper/minimal.squashfs \
  -map "$WORK_DIR/filesystem.manifest" /casper/minimal.manifest \
  -map "$WORK_DIR/filesystem.size" /casper/minimal.size \
  -boot_image any replay -compliance no_emul_toc -padding included -commit
xorriso -osirrox on -indev "$OUT_ISO.tmp" \
  -extract /casper/minimal.squashfs "$WORK_DIR/embedded.squashfs"
test "$(sha256sum "$WORK_DIR/filesystem.squashfs" | awk '{print $1}')" = \
  "$(sha256sum "$WORK_DIR/embedded.squashfs" | awk '{print $1}')"
unsquashfs -d "$WORK_DIR/post-test" "$WORK_DIR/embedded.squashfs"
test -f "$WORK_DIR/post-test/usr/share/wayland-sessions/aarel.desktop"
mv -f "$OUT_ISO.tmp" "$OUT_ISO"
sha256sum "$OUT_ISO" > "$OUT_ISO.sha256"
cp "$WORK_DIR/filesystem.manifest" "$(dirname "$OUT_ISO")/AArel-MMonolith-OS-filesystem.manifest"
echo AAREL_SESSION_REPACK_GATE=PASS
