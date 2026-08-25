from pathlib import Path
import re

s = Path("main.go").read_text(encoding="utf-8")
m = re.search(r"var agentTools = \\[\\]string\\{(.*?)\\n\\}", s, re.S)
assert m, "agentTools catalog missing"
tools = re.findall(r'"([a-z0-9_]+)"', m.group(1))
assert len(tools) == 44, (len(tools), tools)
assert len(set(tools)) == len(tools), "duplicate tools"
required = {
    "apply_patch", "wsl", "process_start", "process_status", "process_stop",
    "app_launch", "app_focus", "app_close", "web_search", "json_read",
    "json_write", "windows_ocr",
}
assert required.issubset(tools), required - set(tools)
for marker in ["HARD_BLOCK:", "UNTRUSTED_WEB_RESULT", "catastrophic disk/boot/shadow-copy"]:
    assert marker in s, marker
print("PASS restore catalog tools=44 unique=44 safety/web markers present")
