# LLera MONOLITH OMEGA — Functional Restore Beta

This is a functional reconstruction of the MONOLITH application, not a UI-only shell.

Restored in this build:
- Native first-party Windows application shell matching the MONOLITH workspace layout.
- Local llama.cpp chat/runtime integration on 127.0.0.1:18191.
- Installed model discovery/start and Instant/Pro/Core/Apex selection.
- HOSTGUARD memory-pressure classification and BelowNormal runtime priority.
- Conversation and Work modes with persistent mission/checkpoint state.
- Agent tool loop with anti-loop protection.
- Structured SHA-256 evidence ledger and independent re-observation after material actions.
- Strict + adversarial dual verifier.
- Outcome Memory, Failure Doctrine and Skill Evolution persistence.
- Integrity Sentinel executable hash observation.
- Vision sidecar on 127.0.0.1:18192 plus Windows OCR fallback.
- Expanded agent capability broker: 44 named tools, including filesystem, patching, CMD/PowerShell/WSL, Git, HTTP/web, DNS/ping/ports/network, process/app lifecycle, JSON, screenshot and OCR.
- Catastrophic disk/boot/shadow-copy command hard-blocks on shell/PowerShell/WSL paths.
- Web search results explicitly tagged UNTRUSTED_WEB_RESULT before model context.
- Read-only signed-update-manifest check surface.

Current parity evidence:
- Historical V2 contract documented 34 tools, including filesystem, terminal/background jobs, Windows app control, desktop control, browser, web and cyber sidecar.
- Historical V3 contract documented 50 unique AGENT_TOOLS plus persistent missions, verifier, time travel, vault, doctor/bench and developer bridge.
- This reconstruction now exposes 44 tools; it is materially closer, but is not claimed to equal the historical 50/62-tool surface yet.

Build verification this turn:
- GOOS=windows GOARCH=amd64 go vet PASS.
- Windows x64 GUI cross-build PASS; PE32+ x86-64.
- restore catalog contract PASS: 44/44 unique tools and safety/web markers.
- EXE SHA-256: 146f439cb480c289c022f8686e738d306219375f4489126ff23d067ab392d3d1
- Source ZIP SHA-256: c7acd0ec4a48bd0557794b796b53673cc997ce95bcdec0a92844d3c6c16ff6e9

Important limitation:
The exact 2026 V5.3.5/V5.4 source archive bytes are still unavailable. This build reconstructs behavior from verified build reports and the original LLera source lineage found in the private repository. It must not be represented as byte-for-byte V5.4 or as physically Windows/GPU validated until that evidence exists.
