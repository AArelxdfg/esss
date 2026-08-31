#!/usr/bin/env bash
set -euo pipefail

ISO="${1:-AArelOS-Linux-Preview-amd64.iso}"
EVIDENCE="${AAREL_EVIDENCE_LEGACY:-$PWD/aarelos-linux-evidence-legacy}"
BOOT_SELECT_WAIT="${AAREL_BOOT_SELECT_WAIT:-12}"
WAIT="${AAREL_LEGACY_BOOT_WAIT:-210}"
MON="$EVIDENCE/qemu-monitor.sock"
PPM="$EVIDENCE/runtime.ppm"
PNG="$EVIDENCE/runtime.png"

[[ -s "$ISO" ]] || { echo "ISO not found: $ISO" >&2; exit 1; }
command -v qemu-system-x86_64 >/dev/null
command -v python3 >/dev/null
mkdir -p "$EVIDENCE"
rm -f "$MON" "$PPM" "$PNG"

if [[ -n "${AAREL_QEMU_ACCEL:-}" ]]; then
  ACCEL="$AAREL_QEMU_ACCEL"
elif [[ -r /dev/kvm ]]; then
  ACCEL=kvm
else
  ACCEL=tcg
fi
if [[ "$ACCEL" == kvm ]]; then CPU=host; else CPU=max; fi
printf 'QEMU acceleration: %s\n' "$ACCEL" | tee "$EVIDENCE/acceleration.txt"

qemu-system-x86_64 \
  -machine pc -accel "$ACCEL" -cpu "$CPU" -m 4G -smp 4 \
  -cdrom "$ISO" -boot d \
  -device virtio-vga -display none \
  -serial file:"$EVIDENCE/serial.log" \
  -monitor unix:"$MON",server,nowait -no-reboot \
  >"$EVIDENCE/qemu.log" 2>&1 &
PID=$!
trap 'kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  [[ -S "$MON" ]] && break
  sleep 1
done
[[ -S "$MON" ]] || { echo "QEMU monitor did not appear" >&2; exit 1; }

sleep "$BOOT_SELECT_WAIT"
python3 - "$MON" <<'PY'
import socket, sys, time
s=socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect(sys.argv[1]); s.recv(4096)
s.sendall(b"sendkey ret\n"); time.sleep(1)
s.recv(4096)
PY

sleep "$WAIT"
python3 - "$MON" "$PPM" <<'PY'
import socket, sys, time
s=socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect(sys.argv[1]); s.recv(4096)
s.sendall(f"screendump {sys.argv[2]}\n".encode()); time.sleep(2)
print(s.recv(4096).decode(errors="replace"))
PY

kill "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true
trap - EXIT
[[ -s "$PPM" ]]

if command -v convert >/dev/null 2>&1; then
  convert "$PPM" "$PNG"
elif command -v magick >/dev/null 2>&1; then
  magick "$PPM" "$PNG"
else
  cp "$PPM" "$PNG"
fi

python3 - "$PNG" <<'PY'
import sys
from PIL import Image
im=Image.open(sys.argv[1]).convert('RGB')
w,h=im.size
colors=len(set(im.resize((160,90)).getdata()))
print(f'resolution={w}x{h} sampled_unique_colors={colors}')
assert w >= 640 and h >= 400
assert colors >= 256, 'legacy boot screen is blank or stuck'
PY

if command -v tesseract >/dev/null 2>&1; then
  tesseract "$PNG" "$EVIDENCE/runtime-ocr" >/dev/null 2>"$EVIDENCE/tesseract.log" || true
  if grep -Eiq 'No bootable|BusyBox|\(initramfs\)|filesystem\.squashfs.*(failed|error)|Can not mount.*/casper/.*squashfs|Try or Install (Ubuntu|Kubuntu)|Ubuntu \(safe graphics\)|Kubuntu \(safe graphics\)' "$EVIDENCE/runtime-ocr.txt"; then
    echo "legacy boot reached a forbidden failure/upstream screen" >&2
    cat "$EVIDENCE/runtime-ocr.txt" >&2
    exit 1
  fi
fi

sha256sum "$ISO" "$PNG" > "$EVIDENCE/SHA256SUMS.txt"
printf 'AAREL_LEGACY_QEMU_SCREEN_GATE=PASS\n'
