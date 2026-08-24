#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-2-Clause

from __future__ import annotations

import argparse
import hashlib
import shutil
import subprocess
from pathlib import Path

PIN = "5f37b60744d49b6ff217cfc60cce54a26f1d9c59"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    if new in text:
        return
    if old not in text:
        raise RuntimeError(f"upstream shape changed: {path}: missing anchor {old!r}")
    path.write_text(text.replace(old, new, 1))


def append_subdirectory(path: Path, anchor: str, entry: str) -> None:
    text = path.read_text()
    if entry in text:
        return
    if anchor not in text:
        raise RuntimeError(f"upstream shape changed: {path}: missing anchor {anchor!r}")
    path.write_text(text.replace(anchor, anchor + entry, 1))


def copy_tree(src: Path, dst: Path) -> None:
    if not src.is_dir():
        raise RuntimeError(f"overlay source missing: {src}")
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)


def apply_patch(repo: Path, patch: Path) -> None:
    if not patch.is_file() or patch.stat().st_size == 0:
        raise RuntimeError(f"patch missing: {patch}")

    check = subprocess.run(
        ["git", "-C", str(repo), "apply", "--check", str(patch)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if check.returncode == 0:
        subprocess.run(["git", "-C", str(repo), "apply", str(patch)], check=True)
        return

    reverse_check = subprocess.run(
        ["git", "-C", str(repo), "apply", "--reverse", "--check", str(patch)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if reverse_check.returncode == 0:
        return

    raise RuntimeError(
        "patch no longer applies cleanly and is not already applied: "
        f"{patch}\n{check.stderr.strip()}"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("serenity", type=Path)
    parser.add_argument("--overlay-root", type=Path, default=Path(__file__).resolve().parents[1] / "overlay")
    parser.add_argument("--patch-root", type=Path, default=Path(__file__).resolve().parents[1] / "patches")
    args = parser.parse_args()

    serenity = args.serenity.resolve()
    overlay = args.overlay_root.resolve()
    patch_root = args.patch_root.resolve()

    git_head = serenity / ".git" / "HEAD"
    if not git_head.exists():
        raise RuntimeError("target does not look like a SerenityOS checkout")

    actual = subprocess.check_output(["git", "-C", str(serenity), "rev-parse", "HEAD"], text=True).strip()
    if actual != PIN:
        raise RuntimeError(f"pinned upstream mismatch: expected {PIN}, got {actual}")

    forge_src = overlay / "Userland" / "Applications" / "Forge"
    forge_dst = serenity / "Userland" / "Applications" / "Forge"
    copy_tree(forge_src, forge_dst)

    apps_cmake = serenity / "Userland" / "Applications" / "CMakeLists.txt"
    append_subdirectory(
        apps_cmake,
        "add_subdirectory(FileManager)\n",
        "add_subdirectory(Forge)\n",
    )

    llera_src = overlay / "Userland" / "Services" / "LLeraService"
    llera_dst = serenity / "Userland" / "Services" / "LLeraService"
    copy_tree(llera_src, llera_dst)

    services_cmake = serenity / "Userland" / "Services" / "CMakeLists.txt"
    append_subdirectory(
        services_cmake,
        "    add_subdirectory(LoginServer)\n",
        "    add_subdirectory(LLeraService)\n",
    )

    system_user = serenity / "Base" / "etc" / "SystemServerUser.ini"
    text = system_user.read_text()
    llera_block = (
        "[LLeraService]\n"
        "Socket=/tmp/session/%sid/portal/llera\n"
        "SocketPermissions=600\n"
        "KeepAlive=true\n"
        "SystemModes=graphical\n\n"
    )
    if "[LLeraService]" not in text:
        anchor = "[LaunchServer]\n"
        if anchor not in text:
            raise RuntimeError("SystemServerUser.ini missing LaunchServer anchor")
        text = text.replace(anchor, llera_block + anchor, 1)

    stock_desktop = "[Desktop]\nExecutable=/bin/FileManager\nArguments=--desktop\nKeepAlive=true"
    forge_desktop = "[Desktop]\nExecutable=/bin/Forge\nKeepAlive=true"
    if forge_desktop not in text:
        if stock_desktop not in text:
            raise RuntimeError("SystemServerUser.ini desktop stanza changed")
        text = text.replace(stock_desktop, forge_desktop, 1)
    system_user.write_text(text)

    motion_patch = patch_root / "0001-windowserver-motion-curves.patch"
    apply_patch(serenity, motion_patch)

    required = [
        forge_dst / "CMakeLists.txt",
        forge_dst / "main.cpp",
        forge_dst / "LLeraConnection.h",
        forge_dst / "LLeraConnection.cpp",
        forge_dst / "LLeraServer.ipc",
        forge_dst / "LLeraClient.ipc",
        llera_dst / "CMakeLists.txt",
        llera_dst / "ConnectionFromClient.h",
        llera_dst / "ConnectionFromClient.cpp",
        llera_dst / "main.cpp",
        llera_dst / "LLeraServer.ipc",
        llera_dst / "LLeraClient.ipc",
        serenity / "Userland" / "Services" / "WindowServer" / "Animation.h",
        serenity / "Userland" / "Services" / "WindowServer" / "Animation.cpp",
    ]
    for file in required:
        if not file.is_file() or file.stat().st_size == 0:
            raise RuntimeError(f"missing generated source: {file}")

    manifest = serenity / "Build" / "aarel-native-overlay.sha256"
    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_text("".join(f"{sha256(p)}  {p.relative_to(serenity)}\n" for p in required))
    print(manifest)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
