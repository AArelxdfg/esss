#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_URL="${AAREL_BASE_URL:-https://cdimage.ubuntu.com/kubuntu/releases/26.04/release/kubuntu-26.04-desktop-amd64.iso}"
BASE_SHA256="${AAREL_BASE_SHA256:-95ce9cf68f13015b9a88bd1ef86fcf7eda77c99979fda48c69e28aa0a84f88ac}"
CACHE_DIR="${AAREL_CACHE:-$HOME/.cache/aarelos-linux}"
WORK_DIR="${AAREL_WORK:-$CACHE_DIR/work}"
BASE_ISO="${AAREL_BASE_ISO:-$CACHE_DIR/kubuntu-26.04-desktop-amd64.iso}"
OUT_ISO="${AAREL_OUT:-$PWD/AArelOS-Linux-Preview-amd64.iso}"
ROOTFS="$WORK_DIR/rootfs"
OLD_SQUASH="$WORK_DIR/filesystem.original.squashfs"
NEW_SQUASH="$WORK_DIR/filesystem.squashfs"
MANIFEST="$WORK_DIR/filesystem.manifest"
FS_SIZE="$WORK_DIR/filesystem.size"
ISO_INFO="$WORK_DIR/info"
MOUNTED=()

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing command: $1" >&2; exit 1; }; }

if [[ "${1:-}" == "--check" ]]; then
  for c in bash curl sha256sum xorriso unsquashfs mksquashfs rsync chroot mount umount; do
    command -v "$c" >/dev/null 2>&1 || true
  done
  bash -n "$SCRIPT_DIR/bootstrap-packages.sh"
  echo "AAREL_REMIX_SCRIPT_GATE=PASS"
  exit 0
fi

if [[ ${EUID} -ne 0 ]]; then
  echo "build-preview.sh must run as root (sudo -E)." >&2
  exit 1
fi

for c in curl sha256sum xorriso unsquashfs mksquashfs rsync chroot mount umount; do need "$c"; done

cleanup() {
  set +e
  for ((i=${#MOUNTED[@]}-1; i>=0; --i)); do
    umount -R "${MOUNTED[$i]}" 2>/dev/null || umount -lf "${MOUNTED[$i]}" 2>/dev/null || true
  done
}
trap cleanup EXIT

mkdir -p "$CACHE_DIR" "$WORK_DIR" "$(dirname "$OUT_ISO")"

if [[ ! -s "$BASE_ISO" ]]; then
  echo "Downloading verified Kubuntu 26.04 LTS base..."
  curl -fL --retry 6 --retry-delay 3 --continue-at - "$BASE_URL" -o "$BASE_ISO"
fi
printf '%s  %s\n' "$BASE_SHA256" "$BASE_ISO" | sha256sum -c -

echo "Inspecting base boot structure..."
xorriso -indev "$BASE_ISO" -report_el_torito plain > "$WORK_DIR/base-el-torito.txt" 2>&1

rm -rf "$ROOTFS" "$OLD_SQUASH" "$NEW_SQUASH"
xorriso -osirrox on -indev "$BASE_ISO" -extract /casper/filesystem.squashfs "$OLD_SQUASH"
unsquashfs -d "$ROOTFS" "$OLD_SQUASH"

# Preserve the base ISO's one-time inline signing key. It is intentionally not
# part of the general Ubuntu archive keyring and is required by Calamares when
# it installs the matching EFI boot packages from the live medium.
install -m 0644 "$ROOTFS/etc/apt/sources.list.d/cdrom.sources" "$WORK_DIR/cdrom.sources"

# AArel-owned files are a clean overlay; base package licenses remain untouched.
rsync -aHAX --chown=root:root --chmod=D755,F644 "$SCRIPT_DIR/overlay/" "$ROOTFS/"
install -m 0755 "$SCRIPT_DIR/bootstrap-packages.sh" "$ROOTFS/tmp/aarel-bootstrap-packages.sh"

# A developer may invoke the remaster from a Windows checkout. Normalize only
# AArel-owned shell assets so CRLF cannot turn a valid shebang into `bash\r`.
find "$ROOTFS/usr/lib/aarel" -maxdepth 1 -type f \( -name '*.sh' -o -name '*.py' \) -exec sed -i 's/\r$//' {} +
sed -i 's/\r$//' "$ROOTFS/usr/bin/mmonolithctl" "$ROOTFS/usr/bin/lleractl" "$ROOTFS/usr/bin/aarel-forge"

# Keep package installation quiet inside the image and prevent daemons from trying
# to start under chroot. The file is removed before the squashfs is produced.
cat > "$ROOTFS/usr/sbin/policy-rc.d" <<'POLICY'
#!/bin/sh
exit 101
POLICY
chmod 0755 "$ROOTFS/usr/sbin/policy-rc.d"
rm -f "$ROOTFS/etc/resolv.conf"
cp -L /etc/resolv.conf "$ROOTFS/etc/resolv.conf"

# The Kubuntu live root carries a file:/cdrom APT source. That source is valid only
# while booted from the original media and breaks remaster chroot package installs.
# Replace all live-media sources with the official Ubuntu network archives before
# apt is invoked, including deb822 .sources files.
mkdir -p "$ROOTFS/etc/apt/sources.list.d"
rm -f "$ROOTFS/etc/apt/sources.list"
find "$ROOTFS/etc/apt/sources.list.d" -maxdepth 1 -type f -delete
cat > "$ROOTFS/etc/apt/sources.list.d/ubuntu.sources" <<'SOURCES'
Types: deb
URIs: http://archive.ubuntu.com/ubuntu/
Suites: resolute resolute-updates resolute-backports
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg

Types: deb
URIs: http://security.ubuntu.com/ubuntu/
Suites: resolute-security
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
SOURCES

mount --rbind /dev "$ROOTFS/dev"; mount --make-rslave "$ROOTFS/dev"; MOUNTED+=("$ROOTFS/dev")
mount -t proc proc "$ROOTFS/proc"; MOUNTED+=("$ROOTFS/proc")
mount --rbind /sys "$ROOTFS/sys"; mount --make-rslave "$ROOTFS/sys"; MOUNTED+=("$ROOTFS/sys")
mount --rbind /run "$ROOTFS/run"; mount --make-rslave "$ROOTFS/run"; MOUNTED+=("$ROOTFS/run")

chroot "$ROOTFS" /usr/bin/env -i \
  HOME=/root TERM=xterm-256color PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  /bin/bash /tmp/aarel-bootstrap-packages.sh

cleanup
MOUNTED=()
rm -f "$ROOTFS/usr/sbin/policy-rc.d" "$ROOTFS/tmp/aarel-bootstrap-packages.sh"
rm -rf "$ROOTFS/var/lib/apt/lists/"* "$ROOTFS/tmp/"* "$ROOTFS/var/tmp/"*

# Calamares temporarily uses the live-media repository to guarantee that the
# matching signed EFI GRUB and shim packages are available during installation.
# It removes this source from the installed target itself.
install -m 0644 "$WORK_DIR/cdrom.sources" \
  "$ROOTFS/etc/apt/sources.list.d/cdrom.sources"

chroot "$ROOTFS" dpkg-query -W --showformat='${Package} ${Version}\n' | sort > "$MANIFEST"
du -sx --block-size=1 "$ROOTFS" | cut -f1 > "$FS_SIZE"

# Zstd cuts iteration time dramatically while remaining supported by modern
# Ubuntu kernels. The day-one target prioritizes iteration speed over minimum ISO size.
mksquashfs "$ROOTFS" "$NEW_SQUASH" -noappend -comp zstd -Xcompression-level 15 -processors "$(nproc)"

cat > "$ISO_INFO" <<'INFO'
AArel OS Linux Preview amd64 — MMonolith / Forge
Derivative base: Kubuntu 26.04 LTS (Ubuntu 26.04 LTS)
INFO

rm -f "$OUT_ISO" "$OUT_ISO.sha256"

# Load the official image, replace only AArel-owned/live-root payloads, and ask
# xorriso to replay the original El Torito + System Area boot equipment. This
# avoids hand-reconstructing fragile BIOS/UEFI boot flags.
xorriso \
  -indev "$BASE_ISO" \
  -outdev "$OUT_ISO" \
  -overwrite on \
  -volid AAREL_OS_PREVIEW \
  -map "$NEW_SQUASH" /casper/filesystem.squashfs \
  -map "$MANIFEST" /casper/filesystem.manifest \
  -map "$FS_SIZE" /casper/filesystem.size \
  -map "$ISO_INFO" /.disk/info \
  -boot_image any replay \
  -compliance no_emul_toc \
  -padding included \
  -commit

sha256sum "$OUT_ISO" | tee "$OUT_ISO.sha256"
xorriso -indev "$OUT_ISO" -report_el_torito plain > "$WORK_DIR/aarel-el-torito.txt" 2>&1
xorriso -indev "$OUT_ISO" -find /casper/filesystem.squashfs -exec lsdl -- > "$WORK_DIR/aarel-payload.txt" 2>&1

printf 'AArel ISO created: %s\n' "$OUT_ISO"
printf 'SHA256: %s\n' "$OUT_ISO.sha256"
printf 'AAREL_GENUINE_ISO_BUILD_GATE=PASS\n'
