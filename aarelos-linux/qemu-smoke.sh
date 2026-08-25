#!/usr/bin/env bash
set -euo pipefail

ISO="${1:-AArelOS-Linux-Preview-amd64.iso}"
EVIDENCE="${AAREL_EVIDENCE:-$PWD/aarelos-linux-evidence}"
WAIT="${AAREL_BOOT_WAIT:-150}"
BOOT_SELECT_WAIT="${AAREL_BOOT_SELECT_WAIT:-12}"
CODE="${AAREL_OVMF_CODE:-/usr/share/OVMF/OVMF_CODE_4M.fd}"
VARS_SRC="${AAREL_OVMF_VARS:-/usr/share/OVMF/OVMF_VARS_4M.fd}"
MON="$EVIDENCE/qemu-monitor.sock"
PPM="$EVIDENCE/runtime.ppm"
PNG="$EVIDENCE/runtime.png"

[[ -s "$ISO" ]] || { echo "ISO not found: $ISO" >&2; exit 1; }
[[ -s "$CODE" && -s "$VARS_SRC" ]] || { echo "OVMF firmware not found" >&2; exit 1; }
command -v qemu-system-x86_64 >/dev/null
command -v python3 >/dev/null
mkdir -p "$EVIDENCE"
cp "$VARS_SRC" "$EVIDENCE/OVMF_VARS.fd"
rm -f "$MON" "$PPM" "$PNG"

# Prefer hardware acceleration on the AArel self-hosted runner. TCG remains a
# portable fallback, but it is too variable for a fixed release-gate deadline.
if [[ -n "${AAREL_QEMU_ACCEL:-}" ]]; then
  ACCEL="$AAREL_QEMU_ACCEL"
elif [[ -r /dev/kvm ]]; then
  ACCEL=kvm
else
  ACCEL=tcg
fi
if [[ "$ACCEL" == "kvm" ]]; then
  CPU=host
else
  CPU=max
fi
printf 'QEMU acceleration: %s\n' "$ACCEL" | tee "$EVIDENCE/acceleration.txt"

set +e
qemu-system-x86_64 \
  -machine q35 -accel "$ACCEL" -cpu "$CPU" -m 4G -smp 4 \
  -drive if=pflash,format=raw,readonly=on,file="$CODE" \
  -drive if=pflash,format=raw,file="$EVIDENCE/OVMF_VARS.fd" \
  -cdrom "$ISO" -boot d \
  -device virtio-vga -display none \
  -serial file:"$EVIDENCE/serial.log" \
  -monitor unix:"$MON",server,nowait -no-reboot \
  >"$EVIDENCE/qemu.log" 2>&1 &
PID=$!
set -e
trap 'kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  [[ -S "$MON" ]] && break
  sleep 1
done
[[ -S "$MON" ]] || { echo "QEMU monitor did not appear" >&2; exit 1; }

# The official Kubuntu menu waits 30 seconds. Select its default entry so the
# smoke deadline measures OS startup rather than an avoidable boot-menu delay.
sleep "$BOOT_SELECT_WAIT"
python3 - "$MON" <<'PY'
import socket, sys, time
s=socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect(sys.argv[1])
s.recv(4096)
s.sendall(b"sendkey ret\n")
time.sleep(1)
print(s.recv(4096).decode(errors="replace"))
PY

sleep "$WAIT"
python3 - "$MON" "$PPM" <<'PY'
import socket, sys, time
s=socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect(sys.argv[1])
s.recv(4096)
s.sendall(f"screendump {sys.argv[2]}\n".encode())
time.sleep(2)
print(s.recv(4096).decode(errors="replace"))
PY

kill "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true
trap - EXIT
[[ -s "$PPM" ]]

# A nonblank firmware or PXE screen is not evidence that the AArel ISO booted.
grep -q 'starting Boot[0-9]* "UEFI QEMU DVD-ROM' "$EVIDENCE/serial.log" || {
  echo "UEFI firmware did not start the ISO" >&2
  exit 1
}
if grep -q 'failed to load Boot[0-9]* "UEFI QEMU DVD-ROM' "$EVIDENCE/serial.log"; then
  echo "UEFI firmware rejected or lost the ISO" >&2
  exit 1
fi

if command -v convert >/dev/null 2>&1; then
  convert "$PPM" "$PNG"
elif command -v magick >/dev/null 2>&1; then
  magick "$PPM" "$PNG"
else
  cp "$PPM" "$PNG"
fi

python3 - "$PNG" <<'PY'
import sys
try:
    from PIL import Image
except Exception:
    print('PIL unavailable: screenshot existence gate only')
    raise SystemExit(0)
im=Image.open(sys.argv[1]).convert('RGB')
w,h=im.size
sample=im.resize((160,90))
colors=len(set(sample.getdata()))
print(f'resolution={w}x{h} sampled_unique_colors={colors}')
assert w >= 640 and h >= 400
assert colors >= 256, 'screen appears blank, stuck on a splash, or too uniform'
PY

if command -v tesseract >/dev/null 2>&1; then
  tesseract "$PNG" "$EVIDENCE/runtime-ocr" >/dev/null 2>"$EVIDENCE/tesseract.log" || true
  if grep -Eiq 'Username|Password' "$EVIDENCE/runtime-ocr.txt"; then
    echo "live boot stopped at an interactive login prompt" >&2
    exit 1
  fi
  grep -Ei 'AArel|Monolith|Forge' "$EVIDENCE/runtime-ocr.txt" > "$EVIDENCE/aarel-visible.txt" || true
fi

sha256sum "$ISO" "$PNG" > "$EVIDENCE/SHA256SUMS.txt"
printf 'acceleration=%s\nboot_wait_seconds=%s\n' "$ACCEL" "$WAIT" > "$EVIDENCE/qemu-smoke.env"
printf 'AAREL_UEFI_QEMU_SCREEN_GATE=PASS\n'
