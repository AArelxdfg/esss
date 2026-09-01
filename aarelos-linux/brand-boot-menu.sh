#!/usr/bin/env bash
set -euo pipefail

ISO="${1:-AArelOS-Linux-Preview-amd64.iso}"
[[ -s "$ISO" ]] || { echo "ISO not found: $ISO" >&2; exit 1; }
command -v xorriso >/dev/null
command -v sha256sum >/dev/null

WORK="$(mktemp -d)"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

PATCH_ROOT="$WORK/patch"
mkdir -p "$PATCH_ROOT/boot/grub"
MAP_ARGS=()
PATCHED=0

extract_patch() {
  local rel="$1"
  local src="$PATCH_ROOT/$rel"
  mkdir -p "$(dirname "$src")"
  if xorriso -osirrox on -indev "$ISO" -extract "/$rel" "$src" >/dev/null 2>&1; then
    cp "$src" "$src.before"
    sed -i \
      -e 's/Try or Install Kubuntu/Try or Install AArelOS/g' \
      -e 's/Try or Install Ubuntu/Try or Install AArelOS/g' \
      -e 's/Kubuntu (safe graphics)/AArelOS (safe graphics)/g' \
      -e 's/Ubuntu (safe graphics)/AArelOS (safe graphics)/g' \
      -e 's/Try Kubuntu/Try AArelOS/g' \
      -e 's/Try Ubuntu/Try AArelOS/g' \
      -e 's/Install Kubuntu/Install AArelOS/g' \
      -e 's/Install Ubuntu/Install AArelOS/g' \
      "$src"
    if ! cmp -s "$src.before" "$src"; then
      PATCHED=$((PATCHED + 1))
    fi
    rm -f "$src.before"
    MAP_ARGS+=( -map "$src" "/$rel" )
  fi
}

extract_patch boot/grub/grub.cfg
extract_patch boot/grub/loopback.cfg

[[ ${#MAP_ARGS[@]} -gt 0 ]] || {
  echo "No GRUB menu configuration found in ISO" >&2
  exit 1
}

if grep -ERn 'Try or Install (Ubuntu|Kubuntu)|(^|[^A-Za-z])(Ubuntu|Kubuntu) \(safe graphics\)|Try (Ubuntu|Kubuntu)|Install (Ubuntu|Kubuntu)' "$PATCH_ROOT/boot/grub"; then
  echo "Upstream visible boot branding remains" >&2
  exit 1
fi

grep -ERq 'AArelOS' "$PATCH_ROOT/boot/grub" || {
  echo "AArelOS branding was not established in boot menu" >&2
  exit 1
}

# Keep the live root byte-identical while replacing only menu text. Replaying
# the source image's boot equipment preserves its hybrid BIOS/UEFI layout.
BEFORE_SQUASH="$WORK/minimal.before.squashfs"
if ! xorriso -osirrox on -indev "$ISO" -extract /casper/minimal.squashfs "$BEFORE_SQUASH" >/dev/null 2>&1; then
  xorriso -osirrox on -indev "$ISO" -extract /casper/filesystem.squashfs "$BEFORE_SQUASH" >/dev/null
fi
BEFORE_SHA="$(sha256sum "$BEFORE_SQUASH" | awk '{print $1}')"

TMP="$ISO.branded.tmp"
rm -f "$TMP"
xorriso \
  -indev "$ISO" \
  -outdev "$TMP" \
  -overwrite on \
  "${MAP_ARGS[@]}" \
  -boot_image any replay \
  -compliance no_emul_toc \
  -padding included \
  -commit >/dev/null
sync "$TMP"

AFTER_SQUASH="$WORK/minimal.after.squashfs"
if ! xorriso -osirrox on -indev "$TMP" -extract /casper/minimal.squashfs "$AFTER_SQUASH" >/dev/null 2>&1; then
  xorriso -osirrox on -indev "$TMP" -extract /casper/filesystem.squashfs "$AFTER_SQUASH" >/dev/null
fi
AFTER_SHA="$(sha256sum "$AFTER_SQUASH" | awk '{print $1}')"
[[ "$BEFORE_SHA" == "$AFTER_SHA" ]] || {
  echo "Live squashfs changed while branding boot menu" >&2
  exit 1
}

xorriso -indev "$TMP" -report_el_torito plain > "$WORK/el-torito.txt" 2>&1
grep -Eiq 'UEFI|EFI' "$WORK/el-torito.txt" || {
  echo "Branded ISO lost UEFI boot entry" >&2
  cat "$WORK/el-torito.txt" >&2
  exit 1
}
grep -Eiq 'BIOS' "$WORK/el-torito.txt" || {
  echo "Branded ISO lost BIOS boot entry" >&2
  cat "$WORK/el-torito.txt" >&2
  exit 1
}

mv -f "$TMP" "$ISO"
sha256sum "$ISO" > "$ISO.sha256"
printf 'patched_boot_configs=%s\n' "$PATCHED"
printf 'AAREL_BOOT_BRANDING_GATE=PASS\n'
