#!/bin/sh
# guard.sh — fail-open deadman. If the keeper dies, protection must go OFF so the TV keeps
# working. Launched by boot.sh / apply.sh / keeper.sh. Never restarts anything.
# Serializes cleanup with mutations; busy/failed cleanup retries next tick.
SELF=$(readlink -f "$0" 2>/dev/null); [ -n "$SELF" ] || SELF="$0"
SELF_DIR=${SELF%/*}
. "$SELF_DIR/common.sh"

ensure_state
# one-manager: a live duplicate exits (same pattern as keeper.sh; S4 Design Decision 3).
gp=$(cat "$STATE/guard.pid" 2>/dev/null)
if [ -n "$gp" ] && [ "$gp" != "$$" ] && pid_alive "$gp" guard; then
  log "guard-duplicate-exit pid=$gp"
  exit 0
fi
echo $$ > "$STATE/guard.pid"
log "guard-start pid=$$"

trap 'lock_release' EXIT
trap 'exit 130' INT TERM HUP

empty=0
while :; do
  sleep "$GUARD_TICK"
  kpid=$(cat "$STATE/keeper.pid" 2>/dev/null)
  if [ -n "$kpid" ]; then
    if ! pid_alive "$kpid" keeper; then
      log "guard-fired keeper-dead"
      lock_try_acquire || continue
      # A new keeper may have appeared since the first observation.
      if keeper_running; then lock_release; continue; fi
      if fail_open_terminal "keeper-dead"; then exit 0; fi
      lock_release
    fi
  else
    empty=$((empty+1))
    [ "$empty" -lt "$GUARD_GRACE" ] && continue
    log "guard-fired keeper-never-started"
    lock_try_acquire || continue
    if keeper_running; then lock_release; continue; fi
    if fail_open_terminal "keeper-never-started"; then exit 0; fi
    lock_release
  fi
done
