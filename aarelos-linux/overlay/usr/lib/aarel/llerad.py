#!/usr/bin/python3
"""LLera policy broker. It authorizes named actions and never executes a shell."""

import json
import os
import signal
import socket
from pathlib import Path

SOCKET_PATH = Path(os.environ.get("LLERA_SOCKET", "/run/llera/control.sock"))
POLICY_PATH = Path(os.environ.get("LLERA_POLICY", "/etc/aarel/llera-policy.json"))
KILL_SWITCH = Path(os.environ.get("LLERA_KILL_SWITCH", "/etc/aarel/llera.disabled"))
running = True


def allowed_actions() -> set[str]:
    try:
        policy = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
        actions = policy.get("allowed_actions", [])
        return {item for item in actions if isinstance(item, str)}
    except (OSError, ValueError, TypeError):
        return set()


def respond(request: dict) -> dict:
    disabled = KILL_SWITCH.exists()
    command = request.get("command", "status")
    if command == "status":
        return {
            "service": "LLera",
            "state": "disabled" if disabled else "running",
            "policy": "default-deny",
            "kill_switch": disabled,
        }
    if command != "authorize":
        return {"service": "LLera", "state": "denied", "reason": "unsupported-command"}

    action = request.get("action")
    authorized = not disabled and isinstance(action, str) and action in allowed_actions()
    return {
        "service": "LLera",
        "state": "authorized" if authorized else "denied",
        "action": action,
        "reason": "allowed" if authorized else ("kill-switch" if disabled else "policy"),
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
        os.chmod(SOCKET_PATH, 0o666)
        server.listen(16)
        server.settimeout(1)
        while running:
            try:
                connection, _ = server.accept()
            except TimeoutError:
                continue
            with connection:
                try:
                    request = json.loads(connection.recv(4096).decode())
                    if not isinstance(request, dict):
                        raise ValueError("request must be an object")
                    response = respond(request)
                except (UnicodeError, ValueError, TypeError):
                    response = {"service": "LLera", "state": "denied", "reason": "invalid-request"}
                connection.sendall((json.dumps(response, sort_keys=True) + "\n").encode())
    SOCKET_PATH.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
