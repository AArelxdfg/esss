# AArel OS Linux Preview

AArel OS Linux Preview is the reproducible Linux release path for AArel
MMonolith OS.  The live system boots into an AArel-owned Plasma Wayland
session through SDDM and uses an AArel GRUB menu. It does not use a downstream
flavour image, flavour identity, or flavour-specific package source.

## Build

Build on a current Ubuntu/WSL2 host with root access, network access, at least
30 GiB of free disk space, and the tools installed by
`aarelos-linux/bootstrap-packages.sh`.

```bash
sudo ./aarelos-linux/bootstrap-packages.sh
sudo ./aarelos-linux/build-preview.sh
```

Before a new full build, run `aarelos-linux/tools/aarel-build-guard.sh`.
It checks the Windows-backed C: volume as well as the Linux workspace and
blocks a build below 20 GiB of host free space unless an operator explicitly
overrides it after reviewing storage.  The build writes a PID/build/output
record next to its flock lock; observe a running build without killing it with
`sudo aarelos-linux/tools/aarel-build-watchdog.sh PID`.

The pinned base URL and SHA-256 are in `aarelos-linux/BASE.lock`.  For a
verified repack of an already prepared isolated root filesystem:

```bash
sudo ./aarelos-linux/repack-verified.sh ROOTFS BASE_ISO OUTPUT_ISO
```

The repack script fully extracts the generated SquashFS before authoring the
ISO, extracts the embedded SquashFS back from the ISO, compares both SHA-256
values, and fully extracts it again before atomically publishing the image.
Build caches and ISO artifacts are intentionally excluded from Git.

After a verified final build, export the only release artifact to Windows with
`sudo aarelos-linux/tools/export-windows-iso.sh SOURCE_ISO`.  It copies through
a temporary file, verifies SHA-256 before publication, and writes the matching
`.sha256` sidecar in `C:\Users\arelx\Downloads`.

## Boot and installation

- VM: create a 64-bit UEFI VM with 4 CPUs, 4 GiB RAM, 40 GiB disk and attach
  `AArelOS-Linux-Preview-amd64.iso` as the optical drive.
- VirtualBox: after the final Windows export, run
  `aarelos-linux/tools/Create-AArel-MMonolith-VM.ps1`.  VirtualBox guest types
  are compiled into VirtualBox itself, so the script truthfully uses `Other_64`
  while applying the AArel MMonolith name and description; it never claims to
  have registered an unsupported custom `AArel/MMonolith` host type.
- QEMU smoke test:
  `sudo ./aarelos-linux/qemu-smoke.sh AArelOS-Linux-Preview-amd64.iso`
- USB: write the ISO in raw/DD mode to the whole USB device, safely eject it,
  then select the UEFI USB entry. Writing an image destroys existing data on
  the selected USB device, so verify the device path first.
- Start **AArel MMonolith OS** from the AArel GRUB menu. Use the safe-graphics
  entry only if the normal DRM path cannot initialize the display.
- Launch the AArel installer from the live environment when it is available,
  select the target disk, and remove the ISO/USB after installation.

## Release verification

The preview release is checked for source/embedded SquashFS hash equality,
two complete decompressions, hybrid UEFI boot, AArel GRUB visibility, SDDM
selection, Plasma Wayland autologin, nonblank desktop rendering, and absence
of the archive installer failure screen.

## Known limitations

- This is a preview image, not a claim of compatibility with every physical
  GPU, Wi-Fi/Bluetooth chipset, multi-monitor layout, or Windows application.
- QEMU validation uses `virtio-vga`; physical Bluetooth, audio routing and
  multi-monitor behavior still require hardware-specific testing.
- Wine is included for compatibility testing but cannot guarantee that every
  `.exe` application will run.
- Secure Boot signing/enrollment and VirtualBox validation depend on host
  tooling and firmware configuration.
- The pinned official Ubuntu archive is used only as the upstream derivative
  foundation; AArel owns the visible boot/session identity and configuration.

See `aarelos-linux/STATUS.md` for exact gate evidence and current release
metadata.
