#!/bin/sh
# keeper.sh — supervises protection while pointer=on. Launched by boot.sh / apply.sh (never by hand).
# Filter death → fail-open FIRST (rules off) → ≤3 bounded restarts w/ backoff → canary → re-flip.
# Give-up is TERMINAL. Upstream re-learned on every recovery. Sleep-loop; never blocks.
SELF=$(readlink -f "$0" 2>/dev/null); [ -n "$SELF" ] || SELF="$0"
SELF_DIR=${SELF%/*}
. "$SELF_DIR/common.sh"

ensure_state
echo $$ > "$STATE/keeper.pid"
log "keeper-start pid=$$"

MAX_ATTEMPTS=3
cmiss=0

while :; do
  sleep "$TICK"

  # guard supervision (cheap, always)
  if ! guard_running; then
    log "keeper-guard-restart"
    "$SELF_DIR/guard.sh" >>"$STATE/guard.log" 2>&1 </dev/null &
  fi

  pointer=$(state_get pointer)
  [ "$pointer" = "on" ] || { cmiss=0; continue; }

  # one-manager: skip while apply/rollback holds the lock. lock_live clears a
  # STALE lock (dead holder) so a killed apply can't wedge the keeper until reboot.
  lock_live && continue

  if filter_running; then
    if canary_sideport; then
      cmiss=0
      # integrity: rules exist (tolerates foreign flush) + upstream still valid
      up=$(state_get upstream)
      if [ -z "$up" ] || ! rules_present "$up"; then
        up2=$(upstream_learn)
        if [ -z "$up2" ] || ! canary_upstream "$up2"; then
          fail_open_terminal "upstream-lost"
          continue
        fi
        if [ "$up2" != "$up" ]; then
          log "keeper-upstream-changed"
          rules_off                      # fail-open first (DNS via new network path)
          filter_kill
          if ! materialize_config "$up2"; then
            fail_open_terminal "upstream-change-materialize"
            continue
          fi
          state_set upstream "$up2"
          filter_start
          if ! canary_sideport; then
            fail_open_terminal "upstream-change-filter"
            continue
          fi
        fi
        rules_on "$up2"
        if canary_system && canary_blocked; then
          log "keeper-rules-readd ok"
        else
          fail_open_terminal "rules-readd-verify"
        fi
      fi
      continue
    fi
    cmiss=$((cmiss+1))
    [ "$cmiss" -lt 2 ] && continue    # two consecutive misses before declaring death
  fi

  # ---- filter dead path ----
  cmiss=0
  log "keeper-filter-dead restore-first"
  rules_off                          # resolver restored FIRST
  filter_kill

  # upstream wait phase (network warmup; does NOT consume restart attempts)
  up=""
  rounds=0
  while [ "$rounds" -lt "$UWAIT_ROUNDS" ]; do
    up=$(upstream_learn)
    if [ -n "$up" ] && canary_upstream "$up"; then break; fi
    up=""
    sleep "$UWAIT_SLEEP"
    rounds=$((rounds+1))
  done
  if [ -z "$up" ]; then
    fail_open_terminal "upstream-wait-timeout"
    continue
  fi
  lock_live && continue                # apply/rollback took over mid-wait: retry next tick
  state_set upstream "$up"
  if ! materialize_config "$up"; then
    fail_open_terminal "materialize"    # never restart the filter on a stale/half config
    continue
  fi

  # bounded restart loop (pauses if apply/rollback takes the lock)
  # Deviation from plan text (2026-09-16): counter renamed n → r. canary_sideport
  # (common.sh) uses a global 'n' (POSIX sh has no local); sharing it made this
  # loop exit after one failed attempt (n clobbered to 3), defeating the intended
  # 3-attempt bound. Log line format "keeper-restart n=..." is unchanged.
  ok=0
  r=0
  while [ "$r" -lt $MAX_ATTEMPTS ]; do
    lock_live && break
    r=$((r+1))
    log "keeper-restart n=$r"
    filter_start
    if canary_sideport; then ok=1; break; fi
    filter_kill
    sleep $((r*BACKOFF))
  done

  lock_live && continue
  if [ "$ok" != "1" ]; then
    fail_open_terminal "restarts-exhausted"
    continue
  fi

  rules_on "$up"
  if canary_system && canary_blocked; then
    log "keeper-recovered"
  else
    fail_open_terminal "recover-verify"
    continue
  fi
done
