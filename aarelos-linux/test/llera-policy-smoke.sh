#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMPDIR="$(mktemp -d)"
SOCKET="$TMPDIR/control.sock"
POLICY="$TMPDIR/policy.json"
KILL_SWITCH="$TMPDIR/disabled"
printf '{"allowed_actions":["launch-forge"]}\n' > "$POLICY"

LLERA_SOCKET="$SOCKET" LLERA_POLICY="$POLICY" LLERA_KILL_SWITCH="$KILL_SWITCH" \
  python3 "$ROOT/overlay/usr/lib/aarel/llerad.py" &
PID=$!
trap 'kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; rm -rf "$TMPDIR"' EXIT
for _ in $(seq 1 50); do
  [[ -S "$SOCKET" ]] && break
  sleep 0.1
done
[[ -S "$SOCKET" ]]

OUTPUT="$(LLERA_SOCKET="$SOCKET" python3 "$ROOT/overlay/usr/bin/lleractl" authorize launch-forge)"
grep -q '"state": "authorized"' <<<"$OUTPUT"

if LLERA_SOCKET="$SOCKET" python3 "$ROOT/overlay/usr/bin/lleractl" authorize arbitrary-shell > "$TMPDIR/denied.json"; then
  printf 'LLera allowed a non-policy action\n' >&2
  exit 1
fi
grep -q '"reason": "policy"' "$TMPDIR/denied.json"

touch "$KILL_SWITCH"
if LLERA_SOCKET="$SOCKET" python3 "$ROOT/overlay/usr/bin/lleractl" authorize launch-forge > "$TMPDIR/killed.json"; then
  printf 'LLera ignored its kill switch\n' >&2
  exit 1
fi
grep -q '"reason": "kill-switch"' "$TMPDIR/killed.json"
printf 'LLERA_POLICY_GATE=PASS\n'
