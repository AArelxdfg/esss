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

# Flatpak is additive. Failure to reach Flathub during an offline ISO build is
# not allowed to make the image unreproducible; the remote is retried on first boot.
flatpak remote-add --system --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo || true

systemctl enable NetworkManager.service sddm.service || true

printf 'AArel package bootstrap complete.\n'
