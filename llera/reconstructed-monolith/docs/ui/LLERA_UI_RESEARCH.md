# LLera UI research notes

## Product patterns reviewed

- OpenAI's desktop product updates describe a unified work switcher, recents, projects, and continuity across surfaces. LLera adopts the useful part of that model: the conversation is the primary workspace while operational detail lives in contextual drawers instead of permanent engineering navigation.
- Raycast's navigation and shortcut documentation reinforces a keyboard-first pattern: searchable actions, arrow-key selection, Enter to execute, and Escape to dismiss. LLera uses a small command palette (`Ctrl/Cmd+K`) for product actions without making commands the whole application.

Sources reviewed on 2026-09-01:

- OpenAI, [ChatGPT release notes](https://help.openai.com/en/articles/6825453-chatgpt-apps-on-ios-and-android)
- Raycast, [Navigation manual](https://manual.raycast.com/navigation)
- Raycast, [Keyboard shortcuts manual](https://manual.raycast.com/keyboard-shortcuts)

## Resulting decisions

1. The left rail is a recent-conversation navigator, not a permanent list of internal contracts.
2. The primary screen is a real composer with attachment handling, visible runtime posture, and a safe blocked state when local inference cannot run.
3. Missions, activity, evidence-adjacent events, and system state appear in contextual drawers so they remain discoverable without overwhelming routine conversation.
4. A compact command palette supports keyboard use and is fully dismissible.
5. Visual tokens favor readable dark surfaces, an explicit focus state, live-region feedback, responsive collapse, and reduced motion by default.
6. The renderer never receives Node access. All operations cross narrowly validated IPC handlers; local model execution remains loopback-only.

## Non-goals for this candidate

This UI does not invent inference, verification, or physical validation results. A missing model, startup failure, or rejected local inference request creates a visible blocked event and preserves the user's message instead of fabricating an assistant response. When configured, requests use the loopback-only llama.cpp chat-completion transport.
