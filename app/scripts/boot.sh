#!/bin/sh
# boot.sh — boot hook (50-lgtv-blocklist-app). Reconciles pointer-vs-live (stray cleanup when
# OFF), clears stale runtime state, launches the supervisors detached. NEVER blocks or fails TV
# startup. If pointer=on, keeper re-arms in the background (bounded wait-for-upstream → restart →
# verify → rules on).
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

if [ "$pointer" = "on" ]; then
  # live state converges via keeper (dead-path re-apply); record intent for the journal
  log "boot-reconcile pointer=on delegated=keeper"
else
  # pointer=off: guarantee no stray live protection from an unclean shutdown.
  # Guarded by cheap chain checks so the common path costs two iptables probes.
  if iptables -t nat -C OUTPUT -j "$RULES_NAT" 2>/dev/null || iptables -C OUTPUT -j "$RULES_FLT" 2>/dev/null; then
    log "boot-reconcile pointer=off stray-rules-found"
    rules_off
    filter_kill
    log "boot-reconcile pointer=off live-cleaned"
  fi
fi

keeper_running || { "$SELF_DIR/keeper.sh" >>"$STATE/keeper.log" 2>&1 </dev/null & }
guard_running  || { "$SELF_DIR/guard.sh"  >>"$STATE/guard.log"  2>&1 </dev/null & }

log "boot-supervisors-started"
exit 0
