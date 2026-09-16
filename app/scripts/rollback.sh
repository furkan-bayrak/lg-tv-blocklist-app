#!/bin/sh
# rollback.sh — turn protection OFF. Fixed entrypoint, no args.
# Rules OFF first (resolver restored instantly), filter killed second.
SELF=$(readlink -f "$0" 2>/dev/null); [ -n "$SELF" ] || SELF="$0"
SELF_DIR=${SELF%/*}
. "$SELF_DIR/common.sh"

ensure_state
if ! lock_acquire; then echo "RESULT=fail"; echo "reason=locked"; exit 0; fi

log "rollback-start"
rules_off
filter_kill
state_set pointer off
rm -f "$STATE/gaveup"
log "rollback-done"
lock_release
echo "RESULT=off"; echo "reason=user-off"
exit 0
