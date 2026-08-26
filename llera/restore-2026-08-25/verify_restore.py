from pathlib import Path
import hashlib
import json
import re
import sys

root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
contract_path = Path(__file__).with_name("V54_PARITY_CONTRACT.json")
contract = json.loads(contract_path.read_text(encoding="utf-8"))

# Locate reconstructed product source without assuming the current working directory.
candidates = [root / "main.go", *root.glob("**/main.go")]
main_go = next((p for p in candidates if p.is_file()), None)
assert main_go, f"reconstructed main.go not found under {root}"
s = main_go.read_text(encoding="utf-8")

m = re.search(r"var agentTools = \\[\\]string\\{(.*?)\\n\\}", s, re.S)
assert m, "agentTools catalog missing"
tools = re.findall(r'"([a-z0-9_]+)"', m.group(1))
assert len(set(tools)) == len(tools), "duplicate tools"
minimum = contract["tool_surface"]["reconstruction_last_verified_tools"]
assert len(tools) >= minimum, (len(tools), minimum, tools)
required = {
    "apply_patch", "wsl", "process_start", "process_status", "process_stop",
    "app_launch", "app_focus", "app_close", "web_search", "json_read",
    "json_write", "windows_ocr",
}
assert required.issubset(tools), required - set(tools)

for marker in ["HARD_BLOCK:", "UNTRUSTED_WEB_RESULT", "catastrophic disk/boot/shadow-copy"]:
    assert marker in s, marker

# Recovery/Native demo shells are not allowed to become the product baseline again.
status_path = Path(__file__).with_name("RESTORE_STATUS.md")
status = status_path.read_text(encoding="utf-8")
assert "functional reconstruction" in status.lower()
assert "not a UI-only shell" in status
assert "exact 2026 V5.3.5/V5.4 source archive bytes are still unavailable" in status

# Pin the only byte identities that may justify an exact historical artifact claim.
expected = contract["exact_artifact_identities"]
assert expected["v5_3_5"]["source_zip_sha256"] == "06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097"
assert expected["v5_4_0"]["source_zip_sha256"] == "b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471"

# Optional artifact arguments can be supplied after the source root. Exact historical
# recognition is hash-based only; names are never enough.
for artifact_arg in sys.argv[2:]:
    p = Path(artifact_arg)
    assert p.is_file(), p
    digest = hashlib.sha256(p.read_bytes()).hexdigest()
    matches = []
    for version, ids in expected.items():
        for kind, known in ids.items():
            if digest == known:
                matches.append(f"{version}:{kind}")
    print(f"ARTIFACT {p} sha256={digest} exact_matches={matches or ['none']}")

print(
    "PASS restore parity guard "
    f"tools={len(tools)} unique={len(set(tools))} minimum={minimum} "
    "safety/web markers present; exact V5.3.5/V5.4 claim hashes pinned"
)
