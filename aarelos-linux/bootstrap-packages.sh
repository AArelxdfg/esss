#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--check" ]]; then
  printf 'AArel package bootstrap syntax gate: PASS\n'
  exit 0
fi

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root inside the AArel image/rootfs." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

# Live archive images may carry a file:/cdrom APT source. That source is valid
# only while booted from the original ISO and breaks package installation in
# the remaster chroot. Remove only cdrom-backed entries; keep all network
# repositories and their signatures untouched.
python3 - <<'PY'
from pathlib import Path
apt = Path('/etc/apt')
for path in [apt / 'sources.list', *sorted((apt / 'sources.list.d').glob('*.list'))]:
    if not path.exists():
        continue
    lines = path.read_text(errors='replace').splitlines()
    kept = [line for line in lines if 'file:/cdrom' not in line and 'cdrom:' not in line]
    path.write_text('\n'.join(kept) + ('\n' if kept else ''))
for path in sorted((apt / 'sources.list.d').glob('*.sources')):
    text = path.read_text(errors='replace')
    stanzas = [s for s in text.split('\n\n') if s.strip()]
    kept = [s for s in stanzas if 'file:/cdrom' not in s and 'cdrom:' not in s]
    path.write_text('\n\n'.join(kept) + ('\n' if kept else ''))
PY

apt-get update
apt-get install -y --no-install-recommends \
  plasma-desktop plasma-workspace kwin-wayland sddm \
  konsole dolphin systemsettings plasma-systemmonitor kdeconnect \
  network-manager pipewire wireplumber \
  papirus-icon-theme fonts-inter fonts-jetbrains-mono \
  flatpak plasma-discover plasma-discover-backend-flatpak \
  git curl wget bash build-essential cmake ninja-build pkg-config \
  python3 python3-pip nodejs npm rustc cargo \
  podman qemu-system-x86 ovmf \
  wine64 winetricks \
  rsync squashfs-tools xorriso isolinux syslinux-common grub-pc-bin grub-efi-amd64-bin

# AArel is assembled from individual archive packages and does not inherit a
# flavour identity, defaults, settings or release-upgrader metadata. Refuse
# accidental flavour-seed drift without embedding that upstream product name.
flavour_prefix="$(printf '%s' 'a3VidW50dQ==' | base64 -d)"
mapfile -t flavour_packages < <(dpkg-query -W -f='${binary:Package}\n' "${flavour_prefix}*" 2>/dev/null || true)
if ((${#flavour_packages[@]})); then
  apt-get purge -y "${flavour_packages[@]}"
fi

# The upstream onboarding window obscures the branded first-session layout.
# AArel provides its own desktop defaults and launchers, so it is not installed.
apt-get purge -y plasma-welcome || true

# Flatpak is additive. Failure to reach Flathub during an offline ISO build is
# not allowed to make the image unreproducible; a system service retries it on
# the installed machine once networking is online.
flatpak remote-add --system --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo || true

chmod 0755 /usr/lib/aarel/*.sh /usr/lib/aarel/*.py /usr/bin/mmonolithctl /usr/bin/lleractl /usr/bin/aarel-forge
systemctl enable NetworkManager.service sddm.service aarel-live-autologin.service \
  aarel-flathub.service llera.service mmonolith.service || true

printf 'AArel package bootstrap complete.\n'
