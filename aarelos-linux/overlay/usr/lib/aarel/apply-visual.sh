#!/usr/bin/env bash
set -euo pipefail

MARKER="${XDG_STATE_HOME:-$HOME/.local/state}/aarel/visual-v1.done"
mkdir -p "$(dirname "$MARKER")"
if [[ -f "$MARKER" && "${1:-}" != "--force" ]]; then
  exit 0
fi

command -v kwriteconfig6 >/dev/null
QDBUS=""
if command -v qdbus6 >/dev/null 2>&1; then QDBUS=qdbus6; elif command -v qdbus >/dev/null 2>&1; then QDBUS=qdbus; fi

kwriteconfig6 --file kdeglobals --group General --key ColorScheme AArelMonolith
kwriteconfig6 --file kdeglobals --group General --key font "Inter,10,-1,5,50,0,0,0,0,0"
kwriteconfig6 --file kdeglobals --group General --key fixed "JetBrains Mono,10,-1,5,50,0,0,0,0,0"
kwriteconfig6 --file kdeglobals --group Icons --key Theme Papirus-Dark
kwriteconfig6 --file kdeglobals --group KDE --key AnimationDurationFactor 0.85
kwriteconfig6 --file kwinrc --group Plugins --key blurEnabled true
kwriteconfig6 --file kwinrc --group Plugins --key contrastEnabled true
kwriteconfig6 --file kwinrc --group Compositing --key Enabled true
kwriteconfig6 --file kwinrc --group Effect-overview --key BorderActivate 9
kwriteconfig6 --file kwinrc --group Windows --key RollOverDesktops true
kwriteconfig6 --file konsolerc --group "Desktop Entry" --key DefaultProfile "AArel Forge.profile"

mkdir -p "$HOME/.local/share/konsole"
cat > "$HOME/.local/share/konsole/AArel Forge.profile" <<'PROFILE'
[Appearance]
ColorScheme=AArelForge
Font=JetBrains Mono,11,-1,5,50,0,0,0,0,0

[General]
Name=AArel Forge
Parent=FALLBACK/

[Scrolling]
HistoryMode=2
ScrollBarPosition=2
PROFILE

if [[ -n "$QDBUS" ]]; then
  for _ in $(seq 1 30); do
    if "$QDBUS" org.kde.plasmashell /PlasmaShell >/dev/null 2>&1; then break; fi
    sleep 1
  done
  if "$QDBUS" org.kde.plasmashell /PlasmaShell >/dev/null 2>&1; then
    "$QDBUS" org.kde.plasmashell /PlasmaShell org.kde.PlasmaShell.evaluateScript "$(cat /usr/share/aarel/plasma-layout.js)" || true
  fi
  "$QDBUS" org.kde.KWin /KWin reconfigure >/dev/null 2>&1 || true
  "$QDBUS" org.kde.plasmashell /PlasmaShell refreshCurrentShell >/dev/null 2>&1 || true
fi

touch "$MARKER"
printf 'AArel Monolith visual profile applied.\n'
