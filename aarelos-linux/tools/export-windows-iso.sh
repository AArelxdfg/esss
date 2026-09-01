#!/usr/bin/env bash
set -euo pipefail

source_iso="${1:?usage: export-windows-iso.sh SOURCE_ISO [DESTINATION_ISO]}"
default_user="${AAREL_WINDOWS_USER:-${USER:-arelx}}"
destination="${2:-/mnt/c/Users/$default_user/Downloads/AArel-MMonolith-OS-amd64.iso}"
[[ -s "$source_iso" ]] || { echo "source ISO is missing: $source_iso" >&2; exit 2; }
mkdir -p "$(dirname "$destination")"
source_size="$(stat -c %s "$source_iso")"
free="$(df -B1 --output=avail "$(dirname "$destination")" | tail -n1 | tr -d '[:space:]')"
if (( free < source_size + 2147483648 )); then
  echo "AAREL_WINDOWS_EXPORT=BLOCK: need ISO size plus 2GiB headroom on destination volume" >&2
  exit 3
fi
tmp="${destination}.partial-$$"
trap 'rm -f -- "$tmp"' EXIT
cp --sparse=always -- "$source_iso" "$tmp"
source_hash="$(sha256sum "$source_iso" | awk '{print $1}')"
dest_hash="$(sha256sum "$tmp" | awk '{print $1}')"
[[ "$source_hash" == "$dest_hash" ]] || { echo "AAREL_WINDOWS_EXPORT=FAIL: SHA-256 mismatch" >&2; exit 4; }
mv -f -- "$tmp" "$destination"
printf '%s  %s\n' "$dest_hash" "$(basename "$destination")" > "${destination}.sha256"
trap - EXIT
printf 'AAREL_WINDOWS_EXPORT=PASS path=%s sha256=%s bytes=%s\n' "$destination" "$dest_hash" "$source_size"
