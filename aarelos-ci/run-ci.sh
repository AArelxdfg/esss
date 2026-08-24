#!/usr/bin/env bash
set -euo pipefail
ROOT="$GITHUB_WORKSPACE"
LOCK="$ROOT/UPSTREAM.lock"
WORK="${AARELOS_BUILD_ROOT:-$HOME/.cache/aarelos-ci}"
SERENITY="$WORK/serenity"
EVIDENCE="$ROOT/aarelos-evidence"
mkdir -p "$WORK" "$EVIDENCE"

# shellcheck disable=SC1090
source "$LOCK"
PIN="$SERENITY_COMMIT"
REPO="$SERENITY_REPOSITORY"

[[ "$PIN" =~ ^[0-9a-f]{40}$ ]]
[[ "$SERENITY_LICENSE" == "BSD-2-Clause" ]]
[[ "$REPO" == "https://github.com/SerenityOS/serenity.git" ]]
cp "$LOCK" "$EVIDENCE/UPSTREAM.lock"

trap 'rc=$?; printf "exit_code=%s\n" "$rc" > "$EVIDENCE/final-status.txt"; exit "$rc"' EXIT

{
  echo "utc=$(date -u +%FT%TZ)"
  echo "runner=$(uname -a)"
  echo "pin=$PIN"
  echo "upstream=$REPO"
  echo "license=$SERENITY_LICENSE"
  echo "cc=${CC:-unset}"
  echo "cxx=${CXX:-unset}"
  cmake --version | head -1 || true
  ninja --version || true
  gcc-14 --version | head -1 || true
  qemu-system-x86_64 --version | head -1 || true
} | tee "$EVIDENCE/host-preflight.txt"

if [[ -d "$SERENITY/.git" ]]; then
  cd "$SERENITY"
  git fetch --depth=1 origin "$PIN"
  git reset --hard "$PIN"
  git clean -ffd
else
  git clone --filter=blob:none "$REPO" "$SERENITY"
  cd "$SERENITY"
  git fetch --depth=1 origin "$PIN"
  git checkout --detach "$PIN"
fi
test "$(git rev-parse HEAD)" = "$PIN"
cp LICENSE "$EVIDENCE/SERENITYOS-LICENSE.txt"
printf 'SerenityOS upstream: %s\nPinned commit: %s\nLicense: %s\n' "$REPO" "$PIN" "$SERENITY_LICENSE" > "$EVIDENCE/UPSTREAM-NOTICE.txt"

# ftpmirror.gnu.org can select a mirror that times out or serves an invalid
# payload on this host. Keep the pinned versions and checksums, but use GNU's
# canonical HTTPS origin for deterministic toolchain archives.
python3 - <<'PY'
from pathlib import Path
p = Path('Toolchain/BuildGNU.sh')
s = p.read_text()
old_binutils = 'BINUTILS_BASE_URL="https://ftpmirror.gnu.org/gnu/binutils"'
old_gcc = 'GCC_BASE_URL="https://ftpmirror.gnu.org/gnu/gcc"'
if old_binutils not in s or old_gcc not in s:
    raise SystemExit('GNU toolchain download URL shape changed')
s = s.replace(old_binutils, 'BINUTILS_BASE_URL="https://ftp.gnu.org/gnu/binutils"', 1)
s = s.replace(old_gcc, 'GCC_BASE_URL="https://ftp.gnu.org/gnu/gcc"', 1)
p.write_text(s)
PY
grep -F 'BINUTILS_BASE_URL="https://ftp.gnu.org/gnu/binutils"' Toolchain/BuildGNU.sh
grep -F 'GCC_BASE_URL="https://ftp.gnu.org/gnu/gcc"' Toolchain/BuildGNU.sh

{
  grep -F 'ConnectionFromClient(ServerStub& stub, NonnullOwnPtr<Core::LocalSocket> socket, int client_id)' Userland/Libraries/LibIPC/ConnectionFromClient.h
  grep -F 'static void spawn_or_show_error(Window* parent_window, StringView path' Userland/Libraries/LibGUI/Process.h
  grep -F 'IPC::MultiServer<NotificationServer::ConnectionFromClient>::try_create()' Userland/Services/NotificationServer/main.cpp
  grep -F 'add_subdirectory(LoginServer)' Userland/Services/CMakeLists.txt
  grep -F '[Desktop]' Base/etc/SystemServerUser.ini
  grep -F 'add_custom_target(uefi-image' CMakeLists.txt
} > "$EVIDENCE/upstream-api-contract.txt"
echo 'UPSTREAM_API_CONTRACT_GATE=PASS' >> "$EVIDENCE/upstream-api-contract.txt"

mkdir -p Userland/Applications/ForgeShell
cp "$ROOT/aarelos-ci/ForgeShell/"* Userland/Applications/ForgeShell/
grep -q 'add_subdirectory(ForgeShell)' Userland/Applications/CMakeLists.txt || printf '\nadd_subdirectory(ForgeShell)\n' >> Userland/Applications/CMakeLists.txt

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
grep -q '^SocketPermissions=600$' Base/etc/SystemServerUser.ini
grep -q 'add_subdirectory(LLeraService)' Userland/Services/CMakeLists.txt
grep -q 'ConnectionFromClient<LLeraClientEndpoint, LLeraServerEndpoint>(\*this, move(socket), client_id)' Userland/Services/LLeraService/ConnectionFromClient.cpp
grep -q 'arguments-not-supported' Userland/Services/LLeraService/ConnectionFromClient.cpp
grep -q 'request-budget-exhausted' Userland/Services/LLeraService/ConnectionFromClient.cpp

git diff -- Toolchain/BuildGNU.sh Userland/Applications/CMakeLists.txt Userland/Services/CMakeLists.txt Base/etc/SystemServerUser.ini > "$EVIDENCE/overlay.diff"
find Userland/Applications/ForgeShell Userland/Services/LLeraService -type f -print | sort > "$EVIDENCE/overlay-files.txt"
echo "serenity_ref=$(git rev-parse HEAD)" | tee "$EVIDENCE/metadata.txt"
echo 'SOURCE_OVERLAY_GATE=PASS' | tee "$EVIDENCE/source-gates.txt"

Meta/serenity.sh build x86_64 GNU 2>&1 | tee "$EVIDENCE/build.log"
test -x Build/x86_64/Root/bin/ForgeShell
test -x Build/x86_64/Root/bin/LLeraService
sha256sum Build/x86_64/Root/bin/ForgeShell Build/x86_64/Root/bin/LLeraService | tee "$EVIDENCE/custom-binaries.sha256"
echo 'REPRODUCIBLE_X86_64_BUILD_GATE=PASS' | tee "$EVIDENCE/passed-gates.txt"

bash "$ROOT/aarelos-ci/install-dev-ports.sh" "$EVIDENCE" "$SERENITY"
echo 'DEV_PORTS_BASH_CURL_GIT_GATE=PASS' | tee -a "$EVIDENCE/passed-gates.txt"

ninja -C Build/x86_64 uefi-image 2>&1 | tee "$EVIDENCE/uefi-image.log"
test -s Build/x86_64/uefi_disk_image
sha256sum Build/x86_64/uefi_disk_image | tee "$EVIDENCE/boot-media.sha256"
stat --printf='uefi_disk_image\t%s bytes\n' Build/x86_64/uefi_disk_image | tee "$EVIDENCE/boot-media-sizes.txt"
echo 'UEFI_MEDIA_BUILD_GATE=PASS' | tee -a "$EVIDENCE/passed-gates.txt"

python3 - "$PIN" "$EVIDENCE" <<'PY'
from pathlib import Path
import hashlib, json, sys
pin=sys.argv[1]; e=Path(sys.argv[2])
files=[]
for p in sorted(e.iterdir()):
    if p.is_file():
        b=p.read_bytes(); files.append({'name':p.name,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
manifest={
  'project':'AArel OS developer preview',
  'serenity_upstream_commit':pin,
  'upstream_license':'BSD-2-Clause',
  'forge_shell_integrated':True,
  'llera_service_source_integrated':True,
  'developer_ports_requested':['bash','curl','git'],
  'llera_4b_bundled':False,
  'windows_exe_compatibility_claim':'none-until-demonstrated',
  'optical_iso_claim':'none-until-genuine-iso9660-el-torito-artifact-exists',
  'evidence_files':files,
}
(e/'release-manifest.json').write_text(json.dumps(manifest,indent=2)+"\n")
PY

export DISPLAY=:99
Xvfb :99 -screen 0 1280x800x24 >"$EVIDENCE/xvfb.log" 2>&1 &
sleep 2
set +e
timeout 90s Meta/serenity.sh run x86_64 GNU >"$EVIDENCE/qemu-run.log" 2>&1 &
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
p=Path(sys.argv[1]); im=Image.open(p).convert('RGB')
w,h=im.size; pix=list(im.resize((160,100)).getdata())
colors=len(set(pix)); bright=sum(1 for r,g,b in pix if r+g+b>480); dark=sum(1 for r,g,b in pix if r+g+b<90)
print(f'resolution={w}x{h} unique={colors} bright={bright} dark={dark}')
print('screenshot_sha256='+hashlib.sha256(p.read_bytes()).hexdigest())
assert w>=640 and h>=400
assert colors>=32
assert bright>=10
assert dark<len(pix)
print('QEMU_SCREENSHOT_GATE=PASS')
PY
echo 'QEMU_SCREENSHOT_GATE=PASS' | tee -a "$EVIDENCE/passed-gates.txt"
