#!/bin/sh
set -eu

# Casper normally creates the live account before systemd starts and records it
# in /etc/sddm.conf. Do not assume a UID: system accounts occupy different UIDs
# across releases (26.04 currently uses 999 for dnsmasq).
live_user="$(sed -n 's/^User=//p' /etc/sddm.conf 2>/dev/null | tail -n 1)"
if [ -z "$live_user" ]; then
    for home in /home/*; do
        [ -d "$home" ] || continue
        live_user="${home##*/}"
        break
    done
fi
if [ -z "$live_user" ]; then
    echo "Casper did not declare or prepare a live account" >&2
    exit 1
fi

# Casper can leave the home directory behind when user-setup-apply fails
# in a remastered image. Repair only the ephemeral Casper system; this service
# is skipped entirely after installation.
if ! getent passwd "$live_user" >/dev/null; then
    getent group "$live_user" >/dev/null || groupadd --gid 1000 "$live_user"
    useradd --uid 1000 --gid "$live_user" --home-dir "/home/$live_user" \
        --shell /bin/bash --groups adm,cdrom,sudo,dip,plugdev "$live_user"
    install -d -o "$live_user" -g "$live_user" -m 0755 "/home/$live_user"
    chown -R "$live_user:$live_user" "/home/$live_user"
fi

# The archive live hooks can place their installer launcher on the ephemeral
# desktop. AArel provides its own installation flow; do not expose that foreign
# launcher in the AArel session.
find "/home/$live_user/Desktop" -maxdepth 1 -type f -name '*.desktop' \
    -exec grep -Il 'ubuntu-desktop-bootstrap\|ubuntu_bootstrap' {} + 2>/dev/null |
    while IFS= read -r launcher; do rm -f -- "$launcher"; done

install -d -m 0755 /etc/sddm.conf.d
# Casper writes Session= to the main file. SDDM gives that value precedence
# over drop-ins, so set the AArel session in the same authoritative file.
if grep -q '^Session=' /etc/sddm.conf 2>/dev/null; then
    sed -i 's/^Session=.*/Session=aarel.desktop/' /etc/sddm.conf
else
    printf '\nSession=aarel.desktop\n' >> /etc/sddm.conf
fi
cat > /etc/sddm.conf.d/99-aarel-live-autologin.conf <<EOF
[Autologin]
Relogin=false
Session=aarel.desktop
User=$live_user
EOF
