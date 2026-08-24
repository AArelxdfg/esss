#!/usr/bin/env bash
set -euo pipefail
EVIDENCE="${1:?evidence dir required}"
SERENITY="${2:?serenity tree required}"
cd "$SERENITY"

# GNU's rotating mirror occasionally returns transient 5xx responses. Keep the
# pinned archive names and hashes, but use the canonical endpoint and make all
# port downloads resilient to short network outages.
python3 - <<'PY'
from pathlib import Path

ports = Path("Ports")
for package in ports.rglob("package.sh"):
    text = package.read_text()
    canonical = text.replace(
        "https://ftpmirror.gnu.org/gnu/", "https://ftp.gnu.org/gnu/"
    )
    if canonical != text:
        package.write_text(canonical)

include = ports / ".port_include.sh"
text = include.read_text()
old = 'run_nocd curl ${curlopts:-} "$url" --fail -L -o "$filename"'
new = (
    'run_nocd curl ${curlopts:-} "$url" --fail -L '
    '--retry 5 --retry-all-errors --retry-delay 2 -o "$filename"'
)
if old not in text and new not in text:
    raise SystemExit("Port curl invocation changed upstream; refusing an unsafe patch")
if old in text:
    include.write_text(text.replace(old, new))
PY

git diff -- Ports/.port_include.sh 'Ports/**/package.sh' \
  > "$EVIDENCE/ports-download-overlay.diff"

# Serenity's documented VM workflow cross-builds ports on the host and
# installs them into the image root before boot. Build only a focused
# developer baseline here; each binary is verified before a PASS is emitted.
ports=(bash curl git)
: > "$EVIDENCE/dev-ports.log"
for port in "${ports[@]}"; do
    echo "=== PORT $port ===" | tee -a "$EVIDENCE/dev-ports.log"
    (
        cd "Ports/$port"
        ./package.sh
    ) 2>&1 | tee -a "$EVIDENCE/dev-ports.log"
done

# Installed-port paths are under /usr/local in Serenity images.
test -x Build/x86_64/Root/usr/local/bin/bash
test -x Build/x86_64/Root/usr/local/bin/curl
test -x Build/x86_64/Root/usr/local/bin/git

sha256sum \
  Build/x86_64/Root/usr/local/bin/bash \
  Build/x86_64/Root/usr/local/bin/curl \
  Build/x86_64/Root/usr/local/bin/git \
  | tee "$EVIDENCE/dev-ports.sha256"

# Use the mature POSIX shell for developer workflows without pretending
# Serenity Shell itself has complete POSIX compatibility.
ln -sf /usr/local/bin/bash Build/x86_64/Root/bin/sh
readlink Build/x86_64/Root/bin/sh | tee "$EVIDENCE/default-sh.txt"

echo 'DEV_PORTS_BASH_CURL_GIT_GATE=PASS' | tee "$EVIDENCE/dev-ports-gate.txt"
