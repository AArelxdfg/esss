#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-2-Clause

from __future__ import annotations

import argparse
import hashlib
import shutil
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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("serenity", type=Path)
    parser.add_argument("--overlay-root", type=Path, default=Path(__file__).resolve().parents[1] / "overlay")
    args = parser.parse_args()

    serenity = args.serenity.resolve()
    overlay = args.overlay_root.resolve()

    git_head = serenity / ".git" / "HEAD"
    if not git_head.exists():
        raise RuntimeError("target does not look like a SerenityOS checkout")

    # The caller is responsible for checking out UPSTREAM.lock. We still require
    # the exact object to exist before mutating the tree so accidental application
    # to an unrelated source tree fails closed.
    import subprocess

    actual = subprocess.check_output(["git", "-C", str(serenity), "rev-parse", "HEAD"], text=True).strip()
    if actual != PIN:
        raise RuntimeError(f"pinned upstream mismatch: expected {PIN}, got {actual}")

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
    block = (
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
        system_user.write_text(text.replace(anchor, block + anchor, 1))

    # Fail closed if the overlay accidentally drops license metadata.
    required = [
        llera_dst / "CMakeLists.txt",
        llera_dst / "ConnectionFromClient.h",
        llera_dst / "ConnectionFromClient.cpp",
        llera_dst / "main.cpp",
        llera_dst / "LLeraServer.ipc",
        llera_dst / "LLeraClient.ipc",
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
