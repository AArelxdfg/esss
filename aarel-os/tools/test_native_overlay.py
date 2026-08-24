#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-2-Clause

from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

import apply_native_overlay as overlay


class NativeOverlayTests(unittest.TestCase):
    def test_append_subdirectory_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "CMakeLists.txt"
            path.write_text("before\n    add_subdirectory(LoginServer)\nafter\n")
            overlay.append_subdirectory(path, "    add_subdirectory(LoginServer)\n", "    add_subdirectory(LLeraService)\n")
            overlay.append_subdirectory(path, "    add_subdirectory(LoginServer)\n", "    add_subdirectory(LLeraService)\n")
            self.assertEqual(path.read_text().count("add_subdirectory(LLeraService)"), 1)

    def test_append_subdirectory_fails_closed_on_upstream_drift(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "CMakeLists.txt"
            path.write_text("upstream changed\n")
            with self.assertRaises(RuntimeError):
                overlay.append_subdirectory(path, "missing\n", "entry\n")

    def test_copy_tree_replaces_stale_overlay(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            src = root / "src"
            dst = root / "dst"
            src.mkdir()
            dst.mkdir()
            (src / "new.cpp").write_text("new\n")
            (dst / "stale.cpp").write_text("stale\n")
            overlay.copy_tree(src, dst)
            self.assertTrue((dst / "new.cpp").is_file())
            self.assertFalse((dst / "stale.cpp").exists())

    def test_replace_once_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config"
            path.write_text("A\nB\n")
            overlay.replace_once(path, "B\n", "C\n")
            overlay.replace_once(path, "B\n", "C\n")
            self.assertEqual(path.read_text(), "A\nC\n")

    def test_apply_patch_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            repo = root / "repo"
            repo.mkdir()
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            target = repo / "sample.txt"
            target.write_text("before\nafter\n")
            patch = root / "change.patch"
            patch.write_text(
                "--- a/sample.txt\n"
                "+++ b/sample.txt\n"
                "@@ -1,2 +1,2 @@\n"
                "-before\n"
                "+patched\n"
                " after\n"
            )

            overlay.apply_patch(repo, patch)
            overlay.apply_patch(repo, patch)
            self.assertEqual(target.read_text(), "patched\nafter\n")

    def test_apply_patch_fails_closed_on_drift(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            repo = root / "repo"
            repo.mkdir()
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            (repo / "sample.txt").write_text("different\n")
            patch = root / "change.patch"
            patch.write_text(
                "--- a/sample.txt\n"
                "+++ b/sample.txt\n"
                "@@ -1 +1 @@\n"
                "-before\n"
                "+after\n"
            )

            with self.assertRaises(RuntimeError):
                overlay.apply_patch(repo, patch)


if __name__ == "__main__":
    unittest.main()
