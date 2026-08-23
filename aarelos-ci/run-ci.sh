#!/usr/bin/env bash
set -euo pipefail
PIN=50c12dd7526f3db052c6d8b10b0d5ee4910d7bdc
ROOT="$GITHUB_WORKSPACE"
WORK="$RUNNER_TEMP/aarelos"
SERENITY="$WORK/serenity"
EVIDENCE="$ROOT/aarelos-evidence"
mkdir -p "$WORK" "$EVIDENCE"

git clone --filter=blob:none https://github.com/SerenityOS/serenity.git "$SERENITY"
cd "$SERENITY"
git fetch --depth=1 origin "$PIN"
git checkout --detach "$PIN"
test "$(git rev-parse HEAD)" = "$PIN"

mkdir -p Userland/Applications/ForgeShell
cp "$ROOT/aarelos-ci/ForgeShell/"* Userland/Applications/ForgeShell/
grep -q 'add_subdirectory(ForgeShell)' Userland/Applications/CMakeLists.txt || printf '\nadd_subdirectory(ForgeShell)\n' >> Userland/Applications/CMakeLists.txt
python3 - <<'PY'
from pathlib import Path
p=Path('Base/etc/SystemServerUser.ini')
s=p.read_text(); old='[Desktop]\nExecutable=/bin/FileManager\nArguments=--desktop\nKeepAlive=true'; new='[Desktop]\nExecutable=/bin/ForgeShell\nKeepAlive=true'
if old in s: s=s.replace(old,new)
elif new not in s: raise SystemExit('Desktop stanza changed; refusing blind patch')
p.write_text(s)
PY

echo "serenity_ref=$(git rev-parse HEAD)" | tee "$EVIDENCE/metadata.txt"
Meta/serenity.sh build x86_64 2>&1 | tee "$EVIDENCE/build.log"
find Build/x86_64 -type f \( -name '*.img' -o -name '*.iso' \) -print0 | xargs -0 -r sha256sum | tee "$EVIDENCE/artifacts.sha256"
test -s "$EVIDENCE/artifacts.sha256"

export DISPLAY=:99
Xvfb :99 -screen 0 1280x800x24 >"$EVIDENCE/xvfb.log" 2>&1 &
sleep 2
set +e
timeout 90s Meta/serenity.sh run x86_64 >"$EVIDENCE/qemu-run.log" 2>&1 &
RUN_PID=$!
sleep 45
import -display :99 -window root "$EVIDENCE/runtime.png" >"$EVIDENCE/screenshot.log" 2>&1
SHOT_RC=$?
wait $RUN_PID
RUN_RC=$?
set -e
printf 'qemu_run_rc=%s\nscreenshot_rc=%s\n' "$RUN_RC" "$SHOT_RC" | tee "$EVIDENCE/runtime-status.txt"
test -s "$EVIDENCE/runtime.png"
python3 - "$EVIDENCE/runtime.png" <<'PY'
from PIL import Image
from pathlib import Path
import sys
p=Path(sys.argv[1]); im=Image.open(p).convert('RGB'); w,h=im.size
pix=list(im.resize((160,100)).getdata()); colors=len(set(pix)); bright=sum(1 for r,g,b in pix if r+g+b>480); dark=sum(1 for r,g,b in pix if r+g+b<90)
print(f'resolution={w}x{h} unique={colors} bright={bright} dark={dark}')
assert w>=640 and h>=400, 'resolution'
assert colors>=32, 'low diversity'
assert bright>=10, 'no highlights'
assert dark<len(pix), 'black frame'
print('RUNTIME_SCREENSHOT_GATE=PASS')
PY
