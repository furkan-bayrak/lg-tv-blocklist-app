#!/bin/sh
# keeper.sh — supervises protection while pointer=on. Launched by boot.sh / apply.sh (never by hand).
# Filter death → fail-open FIRST (rules off) → ≤3 bounded restarts w/ backoff → canary → re-flip.
# Give-up is TERMINAL. Upstream re-learned on every recovery. Sleep-loop; never blocks.
SELF=$(readlink -f "$0" 2>/dev/null); [ -n "$SELF" ] || SELF="$0"
SELF_DIR=${SELF%/*}
. "$SELF_DIR/common.sh"

ensure_state
# one-manager: a live duplicate exits (closes the boot/apply double-spawn race;
# a simultaneous-spawn window remains, see S4 plan Design Decision 3).
kp=$(cat "$STATE/keeper.pid" 2>/dev/null)
if [ -n "$kp" ] && [ "$kp" != "$$" ] && pid_alive "$kp" keeper; then
  log "keeper-duplicate-exit pid=$kp"
  exit 0
fi
echo $$ > "$STATE/keeper.pid"
log "keeper-start pid=$$"

# Only mutation phases hold the shared lock. Every continuation/exit releases
# our own lock; the potentially 15-minute upstream wait explicitly does not.
keeper_unlock() { lock_release; }
keeper_lock_on() {
  lock_try_acquire || return 1
  # Failed Disable retains pointer=on to describe the still-serving filter.
  # Its pending OFF request remains authoritative even after unlocked probes.
  [ "$(state_get pointer)" = on ] && [ ! -e "$STATE/cleanup-pending" ] && return 0
  keeper_unlock
  return 1
}
trap 'keeper_unlock' EXIT
trap 'exit 130' INT TERM HUP

MAX_ATTEMPTS=3
cmiss=0
tseq=0

while :; do
  keeper_unlock
  sleep "$TICK"
  tseq=$((tseq+1))

  # guard supervision (cheap, always)
  if ! guard_running; then
    log "keeper-guard-restart"
    "$SELF_DIR/guard.sh" >>"$STATE/guard.log" 2>&1 </dev/null &
  fi

  # Cleanup failures must retry OFF, never fall through to ON recovery. This
  # also covers an OFF boot with stray rules and a failed first cleanup.
  if [ -e "$STATE/cleanup-pending" ]; then
    if lock_try_acquire; then
      # A successful Apply may have cleared this marker before acquisition.
      # Never let a stale cleanup decision undo its newly verified ON state.
      [ ! -e "$STATE/cleanup-pending" ] || fail_open_terminal "cleanup-retry"
    fi
    continue
  fi

  pointer=$(state_get pointer)
  [ "$pointer" = "on" ] || { cmiss=0; continue; }

  # one-manager: skip while apply/rollback holds the lock. lock_live clears a
  # STALE lock (dead holder) so a killed apply can't wedge the keeper until reboot.
  lock_live && continue

  if filter_alive_cheap; then
    # Cheap liveness (pid + listening port) passed. Run the expensive functional
    # canary only every CANARY_EVERY ticks — per-tick dnsq spawns were the T8
    # ~24 s detection-latency driver under load.
    if [ $((tseq % CANARY_EVERY)) -ne 0 ]; then
      continue
    fi
    if canary_sideport; then
      cmiss=0
      # integrity: rules exist (tolerates foreign flush) + upstream still valid
      up=$(state_get upstream)
      if [ -z "$up" ] || ! rules_present "$up"; then
        keeper_lock_on || continue
        up2=$(upstream_learn)
        if [ -z "$up2" ] || ! canary_upstream "$up2"; then
          fail_open_terminal "upstream-lost"
          continue
        fi
        if [ "$up2" != "$up" ]; then
          log "keeper-upstream-changed"
          rules_off || continue          # keep serving if cleanup is uncertain
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
        if rules_on_verified "$up2"; then
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
  keeper_lock_on || continue
  log "keeper-filter-dead restore-first"
  rules_off || continue              # resolver restored FIRST, or retry OFF
  filter_kill

  # B-budget/T8: a missing binary can never come back by retrying. Recognize it
  # directly BEFORE the upstream wait/restart loop so the terminal is
  # deterministic and fast (T8 path B burned 104 s in canary/backoff).
  if [ ! -f "$FILTER_BIN" ]; then
    fail_open_terminal "filter-binary-missing"
    continue
  fi

  keeper_unlock
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
  # A completed rollback has no live lock left. Re-read intent while holding
  # the lock, including the timeout/terminal path, not just successful recovery.
  keeper_lock_on || continue
  if [ -z "$up" ]; then
    fail_open_terminal "upstream-wait-timeout"
    continue
  fi
  # Apply may have installed a new serving filter and redirects while we
  # waited unlocked. The earlier detachment proof is no longer valid: verify
  # fresh cleanup under this lock before any state/config/filter replacement.
  rules_off || continue
  state_set upstream "$up"
  if ! materialize_config "$up"; then
    fail_open_terminal "materialize"    # never restart the filter on a stale/half config
    continue
  fi

  # Bounded restart loop, serialized with apply/rollback.
  # Deviation from plan text (2026-09-16): counter renamed n → r. canary_sideport
  # (common.sh) uses a global 'n' (POSIX sh has no local); sharing it made this
  # loop exit after one failed attempt (n clobbered to 3), defeating the intended
  # 3-attempt bound. Log line format "keeper-restart n=..." is unchanged.
  ok=0
  r=0
  while [ "$r" -lt $MAX_ATTEMPTS ]; do
    r=$((r+1))
    log "keeper-restart n=$r"
    filter_start
    if canary_sideport; then ok=1; break; fi
    filter_kill
    sleep $((r*BACKOFF))
  done

  if [ "$ok" != "1" ]; then
    fail_open_terminal "restarts-exhausted"
    continue
  fi

  if rules_on_verified "$up"; then
    log "keeper-recovered"
  else
    fail_open_terminal "recover-verify"
  fi
done
