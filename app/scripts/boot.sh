#!/bin/sh
# boot.sh — boot hook (50-lgtv-blocklist-app). Cleans stale runtime state and launches the
# supervisors detached. NEVER blocks or fails TV startup. If pointer=on, keeper re-arms in the
# background (bounded wait-for-upstream → restart → verify → rules on).
SELF=$(readlink -f "$0" 2>/dev/null); [ -n "$SELF" ] || SELF="$0"
SELF_DIR=${SELF%/*}
. "$SELF_DIR/common.sh"

ensure_state
log "boot-start pid=$$"
# reboot wiped all processes: clear stale runtime files (NOT state/intent)
rm -f "$STATE/keeper.pid" "$STATE/guard.pid" "$STATE/filter.pid"
rm -rf "$STATE/lock"
pointer=$(state_get pointer)
[ -n "$pointer" ] || pointer=off
log "boot pointer=$pointer"

keeper_running || { "$SELF_DIR/keeper.sh" >>"$STATE/keeper.log" 2>&1 </dev/null & }
guard_running  || { "$SELF_DIR/guard.sh"  >>"$STATE/guard.log"  2>&1 </dev/null & }

log "boot-supervisors-started"
exit 0
