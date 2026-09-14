#!/bin/sh
# LG TV Blocklist App — startup hook (Slice S1 skeleton).
#
# This file is reached through a symlink at:
#   /var/lib/webosbrew/init.d/50-lgtv-blocklist-app
# It must stay small and must never block TV startup (design spec §3 "Boot").
# S1 scope: prove the hook runs and lands in the app log. Apply/verify logic
# arrives in S3/S4.
#
# webosbrew rules honored here:
#  - the app symlinks this script; it is never copied into init.d
#  - everything goes to a log under /var/lib/webosbrew, then the script exits 0

exec >>/var/lib/webosbrew/lgtvblocklist-app.log 2>&1

printf '%s boot hook ran (S1 skeleton)\n' "$(date '+%Y-%m-%d %H:%M:%S')"

# Resolve our own path through the symlink so later slices can find sibling
# files next to the real script (webosbrew startup-script guide).
SELF="$(readlink -f "$0" 2>/dev/null || echo "$0")"
APP_DIR="$(dirname "$(dirname "$SELF")")"

if [ ! -d "$APP_DIR" ]; then
  printf 'resolved app dir missing: %s\n' "$APP_DIR"
fi

exit 0
