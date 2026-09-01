# LLera Visual QA

Date: 2026-09-01  
Physical environment: Windows, 96 DPI (100% scale)  
Application: packaged `win-unpacked` executable

## Pass 1 critique

The replacement was clearly distinct from the rejected shell and established a calm conversation-first hierarchy. The command palette, empty state, composer, light theme, and supplied LLera logo were coherent. Three issues were rejected:

1. The fixed right drawer covered the right side of the composer at 1440×900.
2. Conversation rename still used a browser-style prompt rather than a product dialog.
3. Modal focus looping was incomplete.

## Refinement

- Wide-screen drawers now reflow the center column; under 1180px they become an overlay.
- Rename now uses a modal with explicit label, Save/Cancel, Escape, focus restoration, and Enter handling.
- Palette, confirmation, and rename dialogs trap Tab/Shift+Tab and restore focus.
- Streaming uses real llama.cpp SSE deltas with a real Stop/abort path.

## Pass 2 inspected states

- New chat — dark — 1440×900
- New chat — dark — 1920×1080
- Settings drawer reflow — 1440×900
- Command palette — dark — 1440×900
- Model-absent picker — dark — 1440×900
- Active conversation with model recovery state — 1440×900
- Real Ctrl+V image preview — 1440×900
- Real Work mission and mission drawer — 1440×900
- Activity drawer with real application events — 1440×900

The screenshots are stored in `llera/final-evidence/ui-screenshots/`. Pass-1 files are intentionally retained to prove the critique/iteration cycle.

## Honest limitations

- A local GGUF model and engine were not present, so physical token streaming could not be captured even though the SSE transport is tested.
- The pasted image was physically persisted and previewed, but Vision/OCR inference could not run without the physical backend.
- Work created a real persisted MissionEngine mission; execution, re-observation, evidence, and finalization remained blocked by the absent configured runtime/tool application assembly.
- Only 100% Windows DPI was physically inspected. Other scale factors require a real scale change/session and remain human validation items.

