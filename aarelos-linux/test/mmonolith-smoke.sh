#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMPDIR="$(mktemp -d)"
SOCKET="$TMPDIR/health.sock"
MMONOLITH_SOCKET="$SOCKET" LLERA_SOCKET="${SOCKET}.missing-llera" \
  python3 "$ROOT/overlay/usr/lib/aarel/mmonolithd.py" &
PID=$!
trap 'kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; rm -rf "$TMPDIR"' EXIT

for _ in $(seq 1 50); do
  [[ -S "$SOCKET" ]] && break
  sleep 0.1
done
[[ -S "$SOCKET" ]]

OUTPUT="$(MMONOLITH_SOCKET="$SOCKET" python3 "$ROOT/overlay/usr/bin/mmonolithctl" health)"
grep -q '"service": "MMonolith"' <<<"$OUTPUT"
grep -q '"state": "degraded"' <<<"$OUTPUT"
grep -q '"LLera": "unavailable"' <<<"$OUTPUT"
[[ "$(stat -c %a "$SOCKET")" == "666" ]]

touch "$TMPDIR/llera.sock"
# The daemon owns LLERA_SOCKET, so restart it with the available-component fixture.
kill "$PID"
wait "$PID" || true
MMONOLITH_SOCKET="$SOCKET" LLERA_SOCKET="$TMPDIR/llera.sock" \
  python3 "$ROOT/overlay/usr/lib/aarel/mmonolithd.py" &
PID=$!
for _ in $(seq 1 50); do
  [[ -S "$SOCKET" ]] && break
  sleep 0.1
done
OUTPUT="$(MMONOLITH_SOCKET="$SOCKET" python3 "$ROOT/overlay/usr/bin/mmonolithctl" status)"
grep -q '"state": "running"' <<<"$OUTPUT"
grep -q '"LLera": "available"' <<<"$OUTPUT"
printf 'MMONOLITH_HEALTH_GATE=PASS\n'
