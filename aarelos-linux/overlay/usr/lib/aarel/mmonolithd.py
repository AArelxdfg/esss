#!/usr/bin/python3
"""Minimal MMonolith system/session health service."""

import json
import os
import signal
import socket
import time
from pathlib import Path

SOCKET_PATH = Path(os.environ.get("MMONOLITH_SOCKET", "/run/mmonolith/health.sock"))
LLERA_SOCKET = Path(os.environ.get("LLERA_SOCKET", "/run/llera/control.sock"))
STARTED = time.monotonic()
running = True


def status() -> dict:
    llera_available = LLERA_SOCKET.exists()
    return {
        "service": "MMonolith",
        "version": "0.1-preview",
        "state": "running" if llera_available else "degraded",
        "uptime_seconds": round(time.monotonic() - STARTED, 3),
        "components": {"LLera": "available" if llera_available else "unavailable"},
    }


def stop(_signum, _frame) -> None:
    global running
    running = False


def main() -> None:
    SOCKET_PATH.parent.mkdir(parents=True, exist_ok=True)
    SOCKET_PATH.unlink(missing_ok=True)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
        server.bind(str(SOCKET_PATH))
        # The endpoint is read-only and intentionally available to desktop users.
        os.chmod(SOCKET_PATH, 0o666)
        server.listen(16)
        server.settimeout(1)
        while running:
            try:
                connection, _ = server.accept()
            except TimeoutError:
                continue
            with connection:
                request = connection.recv(128).decode(errors="replace").strip()
                if request not in {"health", "status"}:
                    response = {"service": "MMonolith", "state": "error", "error": "unsupported command"}
                else:
                    response = status()
                connection.sendall((json.dumps(response, sort_keys=True) + "\n").encode())
    SOCKET_PATH.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
