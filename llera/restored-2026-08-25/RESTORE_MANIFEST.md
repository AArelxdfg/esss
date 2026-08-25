# LLera MONOLITH OMEGA — Functional Restore State

Date: 2026-08-25
Status: **functional reconstruction / beta, not byte-for-byte V5.4**

## Why this restore exists

The previous Recovery/Native binaries were UI-oriented shells and are explicitly deprecated. They are not accepted as LLera product lineage.

The authoritative target is the MONOLITH Workspace application behavior documented by the verified V5.x build reports and the original LLera source lineage in `AArelxdfg/Lerafinitoshgrf`.

## Current reconstructed Windows artifact

- Artifact: `LLera_MONOLITH_OMEGA_Restored_Beta_x64.exe`
- SHA-256: `9fb400266427add232da7a8b81b7a7a9618c5b1aa78d2e936184585054a4fb6b`
- Identity: PE32+ Windows GUI x86-64
- Go static gate: `GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go vet ./...` PASS
- Windows cross-build: PASS

Current source ZIP SHA-256: `20d3764cdfd7349e9e760d1b6d03de6224d75decefdc96dc761280a9c183cf34`.

## Restored behavior — not just UI

- MONOLITH Workspace native Windows shell: top command bar, icon rail, task/workspace tree, tabbed center workspace, live execution/evidence pane and bottom composer.
- Local llama.cpp chat/runtime integration on `127.0.0.1:18191`.
- Installed model discovery/start, custom GGUF registration, Instant/Pro/Core/Apex model selection.
- Runtime health monitoring and recovery path.
- HOSTGUARD memory-pressure classification with BelowNormal child runtime priority and critical-pressure bootstrap fallback.
- Conversation and Work modes.
- Persistent mission/checkpoint state and restart resume attempt.
- Agent tool loop with anti-loop protection.
- Workspace/file/shell/PowerShell/Git/network/process/system tools.
- Material-action independent re-observation.
- Structured evidence ledger with evidence IDs, target binding and SHA-256 result hashes.
- Strict + adversarial dual verifier before mission success.
- Outcome Memory, Failure Doctrine and Skill Evolution persistence.
- Integrity Sentinel executable SHA-256 observation.
- Vision sidecar integration on `127.0.0.1:18192`.
- Windows OCR fallback.
- Screenshot capture tool.
- Read-only update-manifest check surface.

## Authoritative verified historical behavior still used as parity contract

The rebuild must retain/restore these verified V5 capabilities before it can be called full parity:

- V5.1: active `agent.html + agent.js` Workspace, Conversation→persistent Mission bridge, Activity/Operations auto surface, queue/Stop semantics and evidence-required mission completion.
- V5.3: unrestricted local model selection, Vision 4B + OCR, image paste/file/screen reading, 62 agent tools, dual verifier, Outcome Memory, Skill Evolution, Integrity Sentinel, Failure Doctrine and signed Live Update.
- V5.3.1: runtime heartbeat/recovery, fetch/ECONNREFUSED retry, visible queued messages, no empty final responses.
- V5.3.2: HOSTGUARD single-runtime pressure-aware switching and Windows host-pressure telemetry.
- V5.3.5: adaptive inference preemption and structured evidence ledger consumed by the verifier.
- V5.4: AURORA UI/UX while preserving MONOLITH backend contracts.

## Known parity gaps / blockers

1. Exact 2026 V5.3.5/V5.4 source archive bytes remain unavailable. The V5.4 known source SHA-256 is `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471`.
2. The private repository contains genuine older LLera Electron source lineage, but its newest history is December 2025 and therefore cannot be misrepresented as V5.x source.
3. Current reconstructed tool surface is not yet the historical 62-tool set.
4. Exact signed updater install/rollback flow is not restored; current restore exposes read-only update-manifest checking only.
5. Physical Windows/GPU/pagefile/Vision/installer soak evidence is not yet available for this reconstructed artifact.
6. This artifact must not be called byte-for-byte V5.4 or Windows-grade final until those gaps are closed and physical evidence passes.

## Non-negotiable policy

No future LLera artifact may replace backend behavior with a visual mock, browser launcher, WebView-only demo, or chat-only recovery shell and still be labeled as the restored LLera. UI and functional parity are both release requirements.
