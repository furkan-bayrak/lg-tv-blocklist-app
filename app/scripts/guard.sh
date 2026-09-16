#!/bin/sh
# guard.sh — fail-open deadman. If the keeper dies, protection must go OFF so the TV keeps
# working. Launched by boot.sh / apply.sh / keeper.sh. Never restarts anything; never takes
# the lock. Exits after firing once.
SELF=$(readlink -f "$0" 2>/dev/null); [ -n "$SELF" ] || SELF="$0"
SELF_DIR=${SELF%/*}
. "$SELF_DIR/common.sh"

ensure_state
echo $$ > "$STATE/guard.pid"
log "guard-start pid=$$"

empty=0
while :; do
  sleep "$GUARD_TICK"
  kpid=$(cat "$STATE/keeper.pid" 2>/dev/null)
  if [ -n "$kpid" ]; then
    if ! pid_alive "$kpid" keeper; then
      log "guard-fired keeper-dead"
      rules_off
      filter_kill
      state_set pointer off
      log "guard-fail-open done"
      exit 0
    fi
  else
    empty=$((empty+1))
    [ "$empty" -lt "$GUARD_GRACE" ] && continue
    log "guard-fired keeper-never-started"
    rules_off
    filter_kill
    state_set pointer off
    exit 0
  fi
done
