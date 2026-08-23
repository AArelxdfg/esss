#!/usr/bin/env bash
set -euo pipefail
PIN=f0056dbba76bbf28fb38247a35c465746034fedd
ROOT="$GITHUB_WORKSPACE"
WORK="$RUNNER_TEMP/aarelos"
SERENITY="$WORK/serenity"
EVIDENCE="$ROOT/aarelos-evidence"
mkdir -p "$WORK" "$EVIDENCE"

trap 'rc=$?; printf "exit_code=%s\n" "$rc" > "$EVIDENCE/final-status.txt"; exit "$rc"' EXIT

{
  echo "utc=$(date -u +%FT%TZ)"
  echo "runner=$(uname -a)"
  echo "pin=$PIN"
  cmake --version | head -1 || true
  ninja --version || true
  qemu-system-x86_64 --version | head -1 || true
} | tee "$EVIDENCE/host-preflight.txt"

git clone --filter=blob:none https://github.com/SerenityOS/serenity.git "$SERENITY"
cd "$SERENITY"
git fetch --depth=1 origin "$PIN"
git checkout --detach "$PIN"
test "$(git rev-parse HEAD)" = "$PIN"

# Fail early if the pinned upstream APIs no longer match the AArel overlay assumptions.
{
  grep -F 'ConnectionFromClient(ServerStub& stub, NonnullOwnPtr<Core::LocalSocket> socket, int client_id)' Userland/Libraries/LibIPC/ConnectionFromClient.h
  grep -F 'static void spawn_or_show_error(Window* parent_window, StringView path' Userland/Libraries/LibGUI/Process.h
  grep -F 'IPC::MultiServer<NotificationServer::ConnectionFromClient>::try_create()' Userland/Services/NotificationServer/main.cpp
  grep -F 'add_subdirectory(LoginServer)' Userland/Services/CMakeLists.txt
  grep -F '[Desktop]' Base/etc/SystemServerUser.ini
} > "$EVIDENCE/upstream-api-contract.txt"
echo 'UPSTREAM_API_CONTRACT_GATE=PASS' >> "$EVIDENCE/upstream-api-contract.txt"

# ForgeShell desktop overlay.
mkdir -p Userland/Applications/ForgeShell
cp "$ROOT/aarelos-ci/ForgeShell/"* Userland/Applications/ForgeShell/
grep -q 'add_subdirectory(ForgeShell)' Userland/Applications/CMakeLists.txt || printf '\nadd_subdirectory(ForgeShell)\n' >> Userland/Applications/CMakeLists.txt

# Native LLera service overlay.
mkdir -p Userland/Services/LLeraService
cp "$ROOT/aarelos-ci/LLeraService/"* Userland/Services/LLeraService/
python3 - <<'PY'
from pathlib import Path
p=Path('Userland/Services/CMakeLists.txt')
s=p.read_text()
needle='    add_subdirectory(LoginServer)\n'
entry='    add_subdirectory(LLeraService)\n'
if entry not in s:
    if needle not in s:
        raise SystemExit('Services CMake shape changed')
    s=s.replace(needle, needle+entry, 1)
p.write_text(s)
PY

# Replace the stock desktop host with ForgeShell and register the LLera portal.
python3 - <<'PY'
from pathlib import Path
p=Path('Base/etc/SystemServerUser.ini')
s=p.read_text()
old='[Desktop]\nExecutable=/bin/FileManager\nArguments=--desktop\nKeepAlive=true'
new='[Desktop]\nExecutable=/bin/ForgeShell\nKeepAlive=true'
if old in s:
    s=s.replace(old,new)
elif new not in s:
    raise SystemExit('Desktop stanza changed; refusing blind patch')

if '[LLeraService]' not in s:
    anchor='[LaunchServer]\n'
    block='[LLeraService]\nSocket=/tmp/session/%sid/portal/llera\nSocketPermissions=600\nKeepAlive=true\nSystemModes=graphical\n\n'
    if anchor not in s:
        raise SystemExit('LaunchServer anchor missing')
    s=s.replace(anchor,block+anchor,1)
p.write_text(s)
PY

grep -q '^Executable=/bin/ForgeShell$' Base/etc/SystemServerUser.ini
grep -q '^\[LLeraService\]$' Base/etc/SystemServerUser.ini
grep -q 'add_subdirectory(LLeraService)' Userland/Services/CMakeLists.txt
grep -q 'ConnectionFromClient<LLeraClientEndpoint, LLeraServerEndpoint>(\*this, move(socket), client_id)' Userland/Services/LLeraService/ConnectionFromClient.cpp

git diff -- Userland/Applications/CMakeLists.txt Userland/Services/CMakeLists.txt Base/etc/SystemServerUser.ini > "$EVIDENCE/overlay.diff"
find Userland/Applications/ForgeShell Userland/Services/LLeraService -type f -print | sort > "$EVIDENCE/overlay-files.txt"
echo "serenity_ref=$(git rev-parse HEAD)" | tee "$EVIDENCE/metadata.txt"

echo 'SOURCE_OVERLAY_GATE=PASS' | tee "$EVIDENCE/source-gates.txt"

Meta/serenity.sh build x86_64 2>&1 | tee "$EVIDENCE/build.log"
find Build/x86_64 -type f \( -name '*.img' -o -name '*.iso' \) -print0 | xargs -0 -r sha256sum | tee "$EVIDENCE/artifacts.sha256"
find Build/x86_64 -type f \( -name '*.img' -o -name '*.iso' \) -printf '%p\t%s bytes\n' | sort | tee "$EVIDENCE/artifact-sizes.txt"
test -s "$EVIDENCE/artifacts.sha256"

echo 'BUILD_ARTIFACT_GATE=PASS' | tee "$EVIDENCE/passed-gates.txt"

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
import hashlib, sys
p=Path(sys.argv[1])
im=Image.open(p).convert('RGB')
w,h=im.size
pix=list(im.resize((160,100)).getdata())
colors=len(set(pix)); bright=sum(1 for r,g,b in pix if r+g+b>480); dark=sum(1 for r,g,b in pix if r+g+b<90)
print(f'resolution={w}x{h} unique={colors} bright={bright} dark={dark}')
print('screenshot_sha256='+hashlib.sha256(p.read_bytes()).hexdigest())
assert w>=640 and h>=400, 'resolution'
assert colors>=32, 'low diversity'
assert bright>=10, 'no highlights'
assert dark<len(pix), 'black frame'
print('RUNTIME_SCREENSHOT_GATE=PASS')
PY

echo 'QEMU_SCREENSHOT_GATE=PASS' | tee -a "$EVIDENCE/passed-gates.txt"
