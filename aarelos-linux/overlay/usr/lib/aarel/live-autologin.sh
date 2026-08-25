#!/bin/sh
set -eu

# Casper creates the live account before systemd starts. SDDM's Kubuntu drop-in
# has higher precedence than Casper's generated /etc/sddm.conf, so place the
# live-only override last without affecting an installed system.
live_user="$(getent passwd 999 | cut -d: -f1)"
if [ -z "$live_user" ]; then
    echo "AArel live account (uid 999) was not created" >&2
    exit 1
fi

install -d -m 0755 /etc/sddm.conf.d
cat > /etc/sddm.conf.d/99-aarel-live-autologin.conf <<EOF
[Autologin]
Relogin=false
Session=kubuntu-live-environment.desktop
User=$live_user
EOF

