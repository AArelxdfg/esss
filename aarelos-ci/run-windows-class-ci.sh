#!/usr/bin/env bash
set -euo pipefail

ROOT="${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is required}"
BASE="$ROOT/aarelos-ci/run-ci.sh"
THEME="$ROOT/aarelos-ci/branding/AArelDark.ini"
TMP="$ROOT/aarelos-ci/.run-windows-class.generated.sh"

test -s "$BASE"
test -s "$THEME"

python3 - "$BASE" "$TMP" <<'PY'
from pathlib import Path
import sys

src = Path(sys.argv[1]).read_text()
marker = "grep -q 'request-budget-exhausted' Userland/Services/LLeraService/ConnectionFromClient.cpp\n\ngit diff -- Toolchain/BuildGNU.sh Userland/Applications/CMakeLists.txt Userland/Services/CMakeLists.txt Base/etc/SystemServerUser.ini > \"$EVIDENCE/overlay.diff\""
insert = r'''grep -q 'request-budget-exhausted' Userland/Services/LLeraService/ConnectionFromClient.cpp

# AArel OS 0.7 Windows-class identity pass: install a first-party dark theme
# and make it the WindowServer default. Keep the pinned upstream foundation
# and notices intact while moving the visible system identity to AArel OS.
mkdir -p Base/res/themes
cp "$ROOT/aarelos-ci/branding/AArelDark.ini" Base/res/themes/AArelDark.ini
python3 - <<'PYTHEME'
from pathlib import Path
p = Path('Base/etc/WindowServer.ini')
s = p.read_text()
if 'Name=Default' not in s and 'Name=AArelDark' not in s:
    raise SystemExit('WindowServer theme shape changed; refusing blind patch')
s = s.replace('Name=Default', 'Name=AArelDark', 1)
s = s.replace('Rows=2\nColumns=2', 'Rows=1\nColumns=1', 1)
p.write_text(s)
PYTHEME
grep -q '^Name=AArelDark$' Base/etc/WindowServer.ini
grep -q '^Rows=1$' Base/etc/WindowServer.ini
grep -q '^Columns=1$' Base/etc/WindowServer.ini
grep -q '^Name=AArel Dar&k$' Base/res/themes/AArelDark.ini
printf 'AArel OS 0.7 Windows-class identity overlay\nTheme=AArelDark\nWorkspaces=1x1\n' > "$EVIDENCE/windows-class-identity.txt"
echo 'AAREL_NATIVE_IDENTITY_GATE=PASS' | tee -a "$EVIDENCE/passed-gates.txt"

git diff -- Toolchain/BuildGNU.sh Userland/Applications/CMakeLists.txt Userland/Services/CMakeLists.txt Base/etc/SystemServerUser.ini Base/etc/WindowServer.ini > "$EVIDENCE/overlay.diff"
'''
if marker not in src:
    raise SystemExit('run-ci insertion marker changed')
src = src.replace(marker, insert, 1)
Path(sys.argv[2]).write_text(src)
PY

chmod +x "$TMP"
bash "$TMP"
