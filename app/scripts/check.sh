#!/bin/sh
# check.sh — live status probe for the LG TV Blocklist app (Slice S2).
#
# Emits exactly one machine-readable block on stdout (design spec D13b):
#   @@STATUS-BEGIN
#   schema=1
#   ts=<epoch-seconds>           (0 when the TV clock is not set)
#   hook=linked|other|missing    boot-hook symlink state (ours / not ours / absent)
#   hook_target=<path|none>      symlink target when it is a plain path
#   scripts=ok|missing           script files present next to the app
#   @@STATUS-END
#
# Everything else goes to stderr; stdout carries the block only (the UI never
# parses un-delimited stdout). Output stays tiny on purpose: the Homebrew
# Channel /exec bridge on this platform caps stdout at 204800 bytes.
#
# Structure (verify-then-commit skeleton; S3 apply scripts reuse it):
#   PROBE  — read live state only; never trust cached files
#   VERIFY — validate every value against its allowed shape
#   COMMIT — emit the block; exit 0
#
# Runs as root through the HBC /exec bridge. No arguments are ever passed:
# the command is a fixed constant from src/bridge.ts (D13a).
set -u

# Test hook: tests/shell overrides the hook directory to sandboxes.
# On a real TV this variable is never set.
HOOK_DIR="${LGTVB_HOOK_DIR:-/var/lib/webosbrew/init.d}"
HOOK_LINK="$HOOK_DIR/50-lgtv-blocklist-app"

# --- resolve our own location (readlink is best-effort; pure-shell fallback) ---
SELF="$(readlink -f "$0" 2>/dev/null || true)"
[ -n "$SELF" ] || SELF="$0"
case "$SELF" in
  */*) DIR="${SELF%/*}" ;;
  *)   DIR="." ;;
esac
case "$DIR" in
  */*) APP_DIR="${DIR%/*}" ;;
  *)   APP_DIR="$DIR" ;;
esac
EXPECTED_HOOK_TARGET="$APP_DIR/scripts/boot.sh"

# --- PROBE (live state only) ---
ts="$(date +%s 2>/dev/null || true)"

target="$(readlink "$HOOK_LINK" 2>/dev/null || true)"
hook="missing"
hook_target="none"
if [ -n "$target" ]; then
  case "$target" in
    *[!A-Za-z0-9/._-]*) hook="other" ;;
    *) hook="other"; hook_target="$target"
       if [ "$target" = "$EXPECTED_HOOK_TARGET" ]; then
         hook="linked"
       fi ;;
  esac
fi

scripts="missing"
if [ -f "$APP_DIR/scripts/boot.sh" ] && [ -f "$APP_DIR/scripts/check.sh" ]; then
  scripts="ok"
fi

# --- VERIFY (defense in depth: re-check every value before emitting) ---
case "$ts" in
  ''|*[!0-9]*) ts=0 ;;
esac
case "$hook" in
  linked|other|missing) : ;;
  *) hook="missing"; hook_target="none" ;;
esac
case "$hook_target" in
  none) : ;;
  *[!A-Za-z0-9/._-]*) hook="other"; hook_target="none" ;;
  *) : ;;
esac
case "$scripts" in
  ok|missing) : ;;
  *) scripts="missing" ;;
esac

# --- COMMIT ---
echo "@@STATUS-BEGIN"
echo "schema=1"
echo "ts=$ts"
echo "hook=$hook"
echo "hook_target=$hook_target"
echo "scripts=$scripts"
echo "@@STATUS-END"
exit 0
