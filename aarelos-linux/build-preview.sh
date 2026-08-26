#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=BASE.lock
source "$SCRIPT_DIR/BASE.lock"
BASE_URL="${AAREL_BASE_URL:-$LOCK_BASE_URL}"
BASE_SHA256="${AAREL_BASE_SHA256:-$LOCK_BASE_SHA256}"
CACHE_DIR="${AAREL_CACHE:-$HOME/.cache/aarelos-linux}"
BUILD_ID="${AAREL_BUILD_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
WORK_ROOT="${AAREL_WORK:-$CACHE_DIR/builds}"
WORK_DIR="$WORK_ROOT/$BUILD_ID"
BASE_ISO="${AAREL_BASE_ISO:-$CACHE_DIR/$LOCK_BASE_FILENAME}"
OUT_ISO="${AAREL_OUT:-$PWD/AArel-MMonolith-OS-Final-amd64.iso}"
PUBLISH_TMP="${OUT_ISO}.tmp-$BUILD_ID"
LOCK_FILE="$CACHE_DIR/release-build.lock"
ROOTFS="$WORK_DIR/rootfs"
OLD_SQUASH="$WORK_DIR/filesystem.original.squashfs"
NEW_SQUASH="$WORK_DIR/filesystem.squashfs"
ISO_SQUASH_PATH="/casper/minimal.squashfs"
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

for c in curl sha256sum xorriso unsquashfs mksquashfs rsync chroot mount umount flock findmnt; do need "$c"; done

mkdir -p "$CACHE_DIR" "$WORK_ROOT" "$(dirname "$OUT_ISO")"
exec 9>"$LOCK_FILE"
flock -n 9 || { echo "another AArel release build owns $LOCK_FILE" >&2; exit 1; }

cleanup() {
  set +e
  for ((i=${#MOUNTED[@]}-1; i>=0; --i)); do
    umount -R "${MOUNTED[$i]}" 2>/dev/null || umount -lf "${MOUNTED[$i]}" 2>/dev/null || true
  done
}
trap cleanup EXIT

mkdir -p "$WORK_DIR"

if [[ ! -s "$BASE_ISO" ]]; then
  echo "Downloading verified archive base..."
  curl -fL --retry 6 --retry-delay 3 "$BASE_URL" -o "$BASE_ISO.part"
  mv -f "$BASE_ISO.part" "$BASE_ISO"
fi
printf '%s  %s\n' "$BASE_SHA256" "$BASE_ISO" | sha256sum -c -

echo "Inspecting base boot structure..."
xorriso -indev "$BASE_ISO" -report_el_torito plain > "$WORK_DIR/base-el-torito.txt" 2>&1

rm -rf "$ROOTFS" "$OLD_SQUASH" "$NEW_SQUASH"
xorriso -osirrox on -indev "$BASE_ISO" -extract "$ISO_SQUASH_PATH" "$OLD_SQUASH"
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

# The live root carries a file:/cdrom APT source. That source is valid only
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

# The archive's common Calamares machinery is retained, but all flavour UI is
# replaced with AArel-owned identity.  Keep this after package installation so
# package payloads cannot overwrite the release branding or launcher.
rm -rf "$ROOTFS/etc/calamares/branding/ubuntuunity"
install -d -m 0755 "$ROOTFS/etc/calamares/branding/aarel"
install -m 0644 "$ROOTFS/usr/share/wallpapers/AArelMonolith/contents/images/3840x2160.svg" \
  "$ROOTFS/etc/calamares/branding/aarel/welcome.svg"
cat > "$ROOTFS/etc/calamares/branding/aarel/branding.desc" <<'BRANDING'
---
componentName: aarel
windowExpanding: normal
strings:
    productName:         AArel MMonolith OS
    shortProductName:    AArel
    version:             Preview
    shortVersion:        Preview
    versionedName:       AArel MMonolith OS Preview
    shortVersionedName:  AArel Preview
    bootloaderEntryName: AArel MMonolith OS
    productUrl:          https://github.com/AArelxdfg/esss
images:
    productLogo:         "welcome.svg"
    productIcon:         "welcome.svg"
    productWelcome:      "welcome.svg"
style:
   SidebarBackground:    "#090d18"
   SidebarText:          "#FFFFFF"
   SidebarTextCurrent:   "#FFFFFF"
BRANDING
sed -i 's/^branding: .*/branding: aarel/' "$ROOTFS/etc/calamares/settings.conf"
rm -f "$ROOTFS/usr/share/applications/ubuntu-unity-calamares.desktop" \
  "$ROOTFS/usr/share/applications/calamares-launch-oem.desktop" \
  "$ROOTFS/usr/share/icons/hicolor/scalable/apps/ubuntu-unity-installer.svg"
cat > "$ROOTFS/usr/share/applications/aarel-installer.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Version=1.0
Name=Install AArel MMonolith OS
GenericName=AArel Installer
Comment=Install AArel MMonolith OS on this computer
Exec=sudo /usr/bin/calamares-launch-normal
Icon=system-software-install
Terminal=false
StartupNotify=true
Categories=Qt;System;
Keywords=installer;calamares;system;AArel;
DESKTOP

# cups-filters enables three legacy parallel-port modules unconditionally.
# parport_pc can block systemd-modules-load for minutes on modern q35 systems
# without a parallel controller. CUPS retains USB and network printer support;
# applicable kernel modules are loaded automatically from hardware aliases.
rm -f "$ROOTFS/etc/modules-load.d/cups-filters.conf"

# Do not seed upstream web shortcuts onto each user's desktop.
rm -f "$ROOTFS/etc/skel/Desktop/"*.desktop

# Calamares temporarily uses the live-media repository to guarantee that the
# matching signed EFI GRUB and shim packages are available during installation.
# It removes this source from the installed target itself.
install -m 0644 "$WORK_DIR/cdrom.sources" \
  "$ROOTFS/etc/apt/sources.list.d/cdrom.sources"

# The installer automirror module writes the installed deb822 source and
# then unconditionally removes this legacy path. Keep an empty compatibility
# file in the live root so that final cleanup is idempotent on deb822-only APT
# images instead of aborting an otherwise successful installation.
: > "$ROOTFS/etc/apt/sources.list"

chroot "$ROOTFS" dpkg-query -W --showformat='${Package} ${Version}\n' | sort > "$MANIFEST"
du -sx --block-size=1 "$ROOTFS" | cut -f1 > "$FS_SIZE"

# Zstd cuts iteration time dramatically while remaining supported by modern
# Ubuntu kernels. The day-one target prioritizes iteration speed over minimum ISO size.
if findmnt -Rno TARGET "$ROOTFS" | grep -qxv "$ROOTFS"; then
  echo "unexpected mount remains below immutable rootfs snapshot" >&2
  findmnt -R "$ROOTFS" >&2
  exit 1
fi
mksquashfs "$ROOTFS" "$NEW_SQUASH" -noappend -comp zstd -Xcompression-level 15 -processors "$(nproc)"

# A metadata listing is insufficient: force decompression of every data and
# fragment block, then assert critical AArel identity/service files survived.
PRE_ISO_EXTRACT="$WORK_DIR/squashfs-full-test"
unsquashfs -d "$PRE_ISO_EXTRACT" "$NEW_SQUASH"
test -x "$PRE_ISO_EXTRACT/usr/lib/aarel/mmonolithd.py"
test -x "$PRE_ISO_EXTRACT/usr/lib/aarel/llerad.py"
test -f "$PRE_ISO_EXTRACT/etc/aarel-release"
SQUASH_SHA256="$(sha256sum "$NEW_SQUASH" | awk '{print $1}')"

cat > "$ISO_INFO" <<'INFO'
AArel MMonolith OS Final amd64 — MMonolith / LLera / Forge
INFO

rm -f "$PUBLISH_TMP" "$PUBLISH_TMP.sha256"

# Load the official image, replace only AArel-owned/live-root payloads, and ask
# xorriso to replay the original El Torito + System Area boot equipment. This
# avoids hand-reconstructing fragile BIOS/UEFI boot flags.
xorriso \
  -indev "$BASE_ISO" \
  -outdev "$PUBLISH_TMP" \
  -overwrite on \
  -volid AAREL_MMONOLITH \
  -map "$NEW_SQUASH" "$ISO_SQUASH_PATH" \
  -map "$MANIFEST" /casper/minimal.manifest \
  -map "$FS_SIZE" /casper/minimal.size \
  -map "$ISO_INFO" /.disk/info \
  -boot_image any replay \
  -compliance no_emul_toc \
  -padding included \
  -commit

sync "$PUBLISH_TMP"
EMBEDDED_SQUASH="$WORK_DIR/filesystem.from-final-iso.squashfs"
xorriso -osirrox on -indev "$PUBLISH_TMP" -extract "$ISO_SQUASH_PATH" "$EMBEDDED_SQUASH"
EMBEDDED_SHA256="$(sha256sum "$EMBEDDED_SQUASH" | awk '{print $1}')"
test "$SQUASH_SHA256" = "$EMBEDDED_SHA256" || {
  echo "embedded squashfs hash differs from generated squashfs" >&2
  exit 1
}
POST_ISO_EXTRACT="$WORK_DIR/embedded-squashfs-full-test"
unsquashfs -d "$POST_ISO_EXTRACT" "$EMBEDDED_SQUASH"
test -x "$POST_ISO_EXTRACT/usr/lib/aarel/mmonolithd.py"
test -x "$POST_ISO_EXTRACT/usr/lib/aarel/llerad.py"
xorriso -indev "$PUBLISH_TMP" -report_el_torito plain > "$WORK_DIR/aarel-el-torito.txt" 2>&1
xorriso -indev "$PUBLISH_TMP" -find "$ISO_SQUASH_PATH" -exec lsdl -- > "$WORK_DIR/aarel-payload.txt" 2>&1

# Publish only a structurally proven, complete image. The previous known-good
# release remains untouched throughout construction and verification.
mv -f "$PUBLISH_TMP" "$OUT_ISO"
sha256sum "$OUT_ISO" | tee "$OUT_ISO.sha256"
cp "$MANIFEST" "$(dirname "$OUT_ISO")/AArel-MMonolith-OS-filesystem.manifest"

printf 'AArel ISO created: %s\n' "$OUT_ISO"
printf 'SHA256: %s\n' "$OUT_ISO.sha256"
printf 'AAREL_GENUINE_ISO_BUILD_GATE=PASS\n'
