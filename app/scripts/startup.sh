#!/bin/sh
# startup.sh register|remove — manage only our exact startup symlink. No ON/OFF change.
SELF=$(readlink -f "$0" 2>/dev/null); [ -n "$SELF" ] || SELF="$0"
SELF_DIR=${SELF%/*}
. "$SELF_DIR/common.sh"

case ${1:-} in register|remove) action=$1 ;; *) exit 2 ;; esac
[ "$#" -eq 1 ] || exit 2
ensure_state
if ! lock_acquire; then echo 'RESULT=fail'; echo 'reason=locked'; exit 0; fi
trap 'lock_release' EXIT
trap 'exit 130' INT TERM HUP

owned_hook() { [ -L "$HOOK_LINK" ] && [ "$(readlink "$HOOK_LINK" 2>/dev/null)" = "$SELF_DIR/boot.sh" ]; }
hook_exists() { [ -L "$HOOK_LINK" ] || [ -e "$HOOK_LINK" ]; }
failed() { echo 'RESULT=fail'; echo "reason=$1"; exit 0; }

if hook_exists && ! owned_hook; then failed hook-conflict; fi
if [ "$action" = register ]; then
  if ! owned_hook; then
    mkdir -p "$HOOK_DIR" 2>/dev/null || failed hook-write-failed
    # BusyBox/GNU -T refuses a directory appearing at the destination; never
    # follow it or replace a foreign entry. In particular, do not use ln -sf.
    ln -s -T "$SELF_DIR/boot.sh" "$HOOK_LINK" 2>/dev/null || failed hook-write-failed
  fi
  owned_hook || failed hook-write-failed
  echo 'RESULT=ok'; echo 'reason=registered'
else
  if owned_hook; then rm -f "$HOOK_LINK" 2>/dev/null || failed hook-write-failed; fi
  hook_exists && failed hook-write-failed
  echo 'RESULT=ok'; echo 'reason=removed'
fi
