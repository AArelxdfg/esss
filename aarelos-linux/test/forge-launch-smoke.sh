#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

cat > "$TMPDIR/lleractl" <<'STUB'
#!/usr/bin/env bash
[[ "$*" == "authorize launch-forge" ]]
STUB
cat > "$TMPDIR/konsole" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" > "$FORGE_CAPTURE"
STUB
chmod +x "$TMPDIR/lleractl" "$TMPDIR/konsole"

FORGE_CAPTURE="$TMPDIR/args" AAREL_LLERA_CTL="$TMPDIR/lleractl" AAREL_KONSOLE="$TMPDIR/konsole" \
  HOME="$TMPDIR/home" bash "$ROOT/overlay/usr/bin/aarel-forge"
grep -q '^--profile AArel Forge --workdir .*/home$' "$TMPDIR/args"
grep -q '^Name=AArel Forge$' "$ROOT/overlay/usr/share/applications/org.aarel.Forge.desktop"
grep -q '^Exec=/usr/bin/aarel-forge$' "$ROOT/overlay/usr/share/applications/org.aarel.Forge.desktop"
grep -q '^Name=AArel Forge$' "$ROOT/overlay/usr/share/konsole/AArel Forge.profile"
printf 'FORGE_LAUNCH_GATE=PASS\n'
