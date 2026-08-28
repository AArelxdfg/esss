#!/usr/bin/env bash
set -euo pipefail

# Refuse a new image build before Windows' backing volume is exhausted.  A WSL
# ext4 VHD can report plenty of guest free space while C: is already full.
warn_gib="${AAREL_DISK_WARN_GIB:-35}"
stop_gib="${AAREL_DISK_STOP_GIB:-20}"
host_mount="${AAREL_HOST_MOUNT:-/mnt/c}"

bytes_free() {
  df -B1 --output=avail "$1" 2>/dev/null | tail -n 1 | tr -d '[:space:]'
}

if [[ ! -d "$host_mount" ]]; then
  echo "AAREL_DISK_GUARD=SKIP host mount $host_mount is unavailable" >&2
  exit 0
fi

free="$(bytes_free "$host_mount")"
[[ "$free" =~ ^[0-9]+$ ]] || { echo "cannot determine free space on $host_mount" >&2; exit 2; }
free_gib=$((free / 1024 / 1024 / 1024))
printf 'AAREL_DISK_GUARD host=%s free=%sGiB warn=%sGiB stop=%sGiB\n' "$host_mount" "$free_gib" "$warn_gib" "$stop_gib"

if (( free_gib < stop_gib )) && [[ "${AAREL_ALLOW_LOW_SPACE:-0}" != "1" ]]; then
  echo "AAREL_DISK_GUARD=BLOCK: reclaim space or set AAREL_ALLOW_LOW_SPACE=1 after review" >&2
  exit 3
fi
if (( free_gib < warn_gib )); then
  echo "AAREL_DISK_GUARD=WARN: avoid duplicate ISO artifacts and full rebuilds" >&2
else
  echo "AAREL_DISK_GUARD=PASS"
fi
