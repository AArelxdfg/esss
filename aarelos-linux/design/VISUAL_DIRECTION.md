# AArel OS — MMonolith Visual Direction

AArel OS uses an original **Obsidian Glass** language: near-black graphite surfaces, cool moonlight accents, restrained translucency, floating geometry and high-density developer ergonomics. It must feel premium and technical, never childish, gamer-themed, or like a direct Windows/macOS copy.

## Visual contract
- Base canvas: #090B10 / #0D1118
- Surface: #121722 / #171D2A
- Primary text: #F1F4FA
- Secondary text: #A8B0C0
- Accent: #8B93FF (moonlight violet)
- Secondary accent: #65D9FF (cold cyan)
- Success: #70E6B1; warning: #F5C76A; danger: #FF718A
- Radius target: 12–18 px for AArel-owned surfaces
- Shadow: soft, wide, low-opacity; no hard neon glow
- Transparency: readable first, glass second
- Typography: Inter for UI, JetBrains Mono for code/terminal
- Icons: monochrome or low-saturation; visual noise is a defect

## Desktop composition
- Thin floating top status rail for system state, workspace and LLera status.
- Centered floating bottom dock/task surface for running and pinned applications.
- KRunner remains the fast keyboard command/search surface and is branded as AArel Search later.
- Native Plasma adaptive translucency and blur are the baseline. Third-party KWin effects are optional enhancements, never boot requirements.
- Windows retain strong separation from the wallpaper even when transparent.

## Motion
- 160–220 ms normal UI transitions.
- 240–320 ms workspace/overview transitions.
- No bounce-heavy or arcade motion.
- Effects must degrade cleanly on software rendering or low-end GPUs.

## Wallpaper
The default wallpaper is generated as an original vector: dark obsidian field, subtle aurora ribbons, one small moon/crescent signature and sparse star-like particles. It exists to create depth behind glass, not to dominate the desktop.

## AArel rule
If a visual effect reduces legibility, latency, battery life or stability, the effect loses. The premium feeling comes from spacing, typography, motion consistency and hierarchy before blur strength.
