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

Reconstructed-source parity track:
- Historical V2 contract documented 34 tools.
- Historical V4 contract documented a 56-unique-tool hardening gate; reconstructed-monolith now preserves a 56-tool registry while the packaged restore beta still exposes 44 named broker tools.
- `src/evidence-ledger.js` now binds evidence IDs to mission, step, target and SHA-256, rejects digest mismatches, and supports post-action binding verification.
- `src/dual-verifier.js` now requires evidence plus independent Strict and Adversarial check sets, each with a default 0.62 minimum score.
- Deterministic evidence/verifier tests cover valid binding, target mismatch, tampering, digest mismatch, dual-verifier PASS and rejection paths.

Latest deterministic source verification:
- evidence + dual verifier test PASS.
- Node syntax check PASS for both restored modules.
- evidence-ledger.js SHA-256: f0bcd0799b1188623834825a1440e2e11a15e20e77b01a70bfdada9db7b17466
- dual-verifier.js SHA-256: 388c6bfc417561fbbcbf00ed5f1c2e971d77def5a224355b6d142b606eba7851
- evidence-verifier.test.js SHA-256: a19c4e92e7611ca27de9fbc7c0dd7632ffe7bd3dfde84636940dea8d88e3bdb1

Previous packaged build verification:
- GOOS=windows GOARCH=amd64 go vet PASS.
- Windows x64 GUI cross-build PASS; PE32+ x86-64.
- restore catalog contract PASS: 44/44 unique tools and safety/web markers.
- EXE SHA-256: 146f439cb480c289c022f8686e738d306219375f4489126ff23d067ab392d3d1
- Source ZIP SHA-256: c7acd0ec4a48bd0557794b796b53673cc997ce95bcdec0a92844d3c6c16ff6e9

Important limitation:
The exact 2026 V5.3.5/V5.4 source archive bytes are still unavailable. The V5.4 report records source ZIP SHA-256 b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471, but the matching source archive has not been recovered from File Library or GitHub. This build reconstructs behavior from verified build reports and the original LLera source lineage. It must not be represented as byte-for-byte V5.4, full parity, or physically Windows/GPU validated until that evidence exists.
