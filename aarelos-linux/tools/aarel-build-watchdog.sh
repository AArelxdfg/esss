#!/usr/bin/env bash
set -euo pipefail

pid="${1:?usage: aarel-build-watchdog.sh PID [interval-seconds] [samples]}"
interval="${2:-60}"
samples="${3:-5}"
[[ "$pid" =~ ^[0-9]+$ && "$interval" =~ ^[0-9]+$ && "$samples" =~ ^[0-9]+$ ]] || exit 2

previous=""
stalled=0
for ((n=1; n<=samples; n++)); do
  if [[ ! -r "/proc/$pid/io" ]]; then
    echo "AAREL_WATCHDOG=EXIT pid=$pid is no longer present"
    exit 0
  fi
  read_bytes="$(awk '/read_bytes/ {print $2}' "/proc/$pid/io")"
  write_bytes="$(awk '/write_bytes/ {print $2}' "/proc/$pid/io")"
  state="$(awk '/^State/ {print $2}' "/proc/$pid/status")"
  host_free="$(df -B1 --output=avail /mnt/c 2>/dev/null | tail -n1 | tr -d '[:space:]' || true)"
  now="$read_bytes:$write_bytes:$state"
  printf 'AAREL_WATCHDOG sample=%s pid=%s io=%s state=%s host_free_bytes=%s\n' "$n" "$pid" "$read_bytes:$write_bytes" "$state" "${host_free:-unknown}"
  if [[ "$now" == "$previous" ]]; then stalled=$((stalled + 1)); else stalled=0; fi
  if (( stalled >= 3 )); then
    echo "AAREL_WATCHDOG=STALL: inspect dmesg and build log; watchdog never kills a build" >&2
    exit 4
  fi
  previous="$now"
  (( n < samples )) && sleep "$interval"
done
echo "AAREL_WATCHDOG=PASS"
