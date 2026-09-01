# LLera Ultimate Product Research

Research completed 2026-09-01 before the renderer replacement. References were used for interaction and architecture study only; no third-party source code or branded assets were copied.

## PI-Desktop — vastsa/PI-Desktop (open source)

- **What works:** Local-first sessions, project grouping, explicit change/command approvals, message-scoped diffs, guarded rollback, side-panel workbench, model configuration, light/dark/system themes, and narrow renderer privileges.
- **What does not work:** Its very broad extension and workbench surface can expose more product machinery than a general desktop assistant needs. The project also describes parts of platform qualification and UI E2E coverage as unfinished.
- **What LLera can learn:** Keep the transcript authoritative, show approvals at the moment of risk, keep work artifacts adjacent to the conversation, and isolate native capabilities from the renderer.
- **What LLera must not copy:** Provider-centric setup, coding-project hierarchy, plugin-marketplace presentation, or its visual identity.
- **Reference:** https://github.com/vastsa/PI-Desktop

## Pi Desktop — rubengarciajr/pi-desktop (open source)

- **What works:** Streaming chat, smart scroll ownership, collapsible tool output, multi-session work, model grouping, and follow-up messages during long tasks.
- **What does not work:** Multi-tab agent density is useful for coding but risks making a focused assistant feel like an IDE.
- **What LLera can learn:** Streaming should never steal scroll from the reader; tool details should stay collapsed until requested.
- **What LLera must not copy:** Tab-heavy composition or provider-specific terminology.
- **Reference:** https://github.com/rubengarciajr/pi-desktop

## Async IDE (open source)

- **What works:** Agent-first Think → Plan → Execute → Observe loop, inline tool cards, interruptibility, approvals, and Git-native review.
- **What does not work:** Editor, terminal, Git, and agent surfaces together create IDE density unsuitable as LLera's default state.
- **What LLera can learn:** Expose meaningful milestones, keep Stop available, and make changes reviewable without dumping raw logs.
- **What LLera must not copy:** Monaco/IDE chrome or permanent multi-pane layout.
- **Reference:** https://github.com/ZYKJShadow/Async

## OpenAgentd (open source)

- **What works:** Drag-and-drop files, image viewer, command palette, inspector, inline diffs, persistent memory, and explicit tool visibility.
- **What does not work:** A "cockpit" framing can make normal conversation secondary and turn internal telemetry into the product.
- **What LLera can learn:** Put advanced detail one click away and make images/files feel native.
- **What LLera must not copy:** Telemetry-dashboard framing, command syntax, or visual language.
- **Reference:** https://github.com/CodewithMubasher/OpenAgent

## Pi Agent Desktop — DLYZZT/pi-desktop (open source)

- **What works:** Three-process Electron separation, controlled MessagePort IPC, streamed sessions, date-grouped history, stable titles, and cross-platform packaging.
- **What does not work:** A complete extension/runtime manager can make settings and setup feel operational rather than conversational.
- **What LLera can learn:** Keep renderer contracts narrow, group history by time, and preserve stable session identity.
- **What LLera must not copy:** Pi-specific command and extension concepts.
- **Reference:** https://github.com/DLYZZT/pi-desktop

## OpenAI Codex and ChatGPT desktop (official)

- **What works:** Unified recents, persistent project/task history, conversation-first progress, contextual review panels, background work, and an explicit distinction between quick chat and end-to-end work.
- **What does not work:** Public Windows reports describe right panels being clipped, hover sidebars covering scrollbars, and old conversations becoming undiscoverable. Feedback also shows that large product-mode reshuffles can disorient established users.
- **What LLera can learn:** Keep Chat and Work continuous, surface progress inside the thread, and open one stable contextual drawer without covering the conversation scrollbar.
- **What LLera must not copy:** Branding, exact shell proportions, task terminology, icons, or component composition.
- **References:** https://openai.com/codex/ and https://help.openai.com/en/articles/6825453-chatgpt-apps-on-ios-and-android and https://github.com/openai/codex/issues/26123 and https://github.com/openai/codex/issues/22363

## Raycast (official manuals)

- **What works:** Keyboard-first action discovery, predictable Enter/Escape behavior, compact hierarchy, fast fuzzy filtering, and contextual commands.
- **What does not work:** A command launcher is not a durable workspace; making every feature a command harms discoverability for occasional users.
- **What LLera can learn:** Ctrl+K should be instant, navigable, contextual, and reversible with reliable focus return.
- **What LLera must not copy:** Launcher-first presentation or shortcut vocabulary wholesale.
- **References:** https://manual.raycast.com/navigation and https://manual.raycast.com/keyboard-shortcuts

## Linear (official documentation)

- **What works:** Dense but calm information hierarchy, strong keyboard support, restrained status color, and predictable command menus.
- **What does not work:** Issue-management structures become bureaucratic when applied directly to personal AI work.
- **What LLera can learn:** Status should be legible from shape, copy, and position—not color alone.
- **What LLera must not copy:** Jira-like lists, boards, issue metadata, or task taxonomy.
- **Reference:** https://linear.app/docs/board-layout

## Negative-feedback synthesis

- **Hidden history:** A conversation that exists on disk but disappears from navigation is effectively lost. LLera keeps recents directly visible and searchable, without a recent-count cutoff.
- **Too many panels:** Permanent multi-pane layouts clip at Windows sizes and scales. LLera uses one contextual drawer, overlays it at narrow widths, and never opens it on hover.
- **Excessive empty space:** Empty state copy is one short question with immediate actions; no architecture explanation or giant card.
- **Constant layout switching:** Chat and Work share one transcript, composer, navigation, and drawer system.
- **Technical overload:** Runtime, verifier, evidence IDs, and HOSTGUARD stay quiet unless actionable or explicitly expanded.
- **Activity overload:** Balanced density is default; tool traces collapse into meaningful milestones.
- **Slow/choppy UI:** Motion is transform/opacity-based, reduced-motion aware, and optional detail is rendered lazily.
- **Weak hierarchy:** Typography, spacing, and tonal surfaces lead; borders are used only for focus, separation, and risk.

## Product architecture decisions

1. Persistent, collapsible content sidebar with date-grouped history.
2. One conversation/work continuum in the center.
3. One right context system for mission, activity, evidence, models, and settings.
4. Floating multiline composer with actual attachment/runtime state.
5. Inline progress and approvals; raw detail only on demand.
6. Structured application events from main to renderer, with snapshot recovery after missed events.
7. Narrow validated IPC; no generic filesystem or shell capability.
8. Dark, light, and system themes built from semantic tokens.

