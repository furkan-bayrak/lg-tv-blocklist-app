#!/bin/sh
# apply.sh — turn protection ON. Fixed entrypoint, no args.
# Ordered fail-open apply (D12): lock → capability probe → learn+validate upstream →
# materialize config → filter on side port → side-port canary → rules ON → end-to-end
# canary + blocked check → pointer LAST. Any failure: rules OFF first, filter second.
SELF=$(readlink -f "$0" 2>/dev/null); [ -n "$SELF" ] || SELF="$0"
SELF_DIR=${SELF%/*}
. "$SELF_DIR/common.sh"

ensure_state
if ! lock_acquire; then echo "RESULT=fail"; echo "reason=locked"; exit 0; fi

cap_probe
if [ "$CAP" != "dnat" ]; then
  log "apply-degraded cap=$CAP"
  lock_release
  echo "RESULT=degraded"; echo "reason=no-firewall-layer"
  exit 0
fi

log "apply-start"
up=$(upstream_learn)
if [ -z "$up" ] || ! canary_upstream "$up"; then
  log "apply-fail stage=upstream"
  lock_release
  echo "RESULT=fail"; echo "reason=upstream-unreachable"
  exit 0
fi

if ! materialize_config "$up"; then
  log "apply-fail stage=materialize"
  lock_release
  echo "RESULT=fail"; echo "reason=materialize"
  exit 0
fi

filter_start
if ! canary_sideport; then
  log "apply-fail stage=sideport"
  filter_kill
  lock_release
  echo "RESULT=fail"; echo "reason=filter-sideport"
  exit 0
fi
log "apply-sideport-ok"

rules_on "$up"
if ! rules_present "$up"; then
  log "apply-fail stage=rules"
  rules_off; filter_kill
  lock_release
  echo "RESULT=fail"; echo "reason=rules-add"
  exit 0
fi
log "apply-rules-on"

if ! canary_system; then
  log "apply-fail stage=e2e"
  rules_off; filter_kill            # restore resolver FIRST, filter second
  lock_release
  echo "RESULT=fail"; echo "reason=verify-canary"
  exit 0
fi
if ! canary_blocked; then
  log "apply-fail stage=blocked"
  rules_off; filter_kill
  lock_release
  echo "RESULT=fail"; echo "reason=verify-blocked"
  exit 0
fi

state_set upstream "$up"
state_set cap "$CAP"
state_set pointer on
rm -f "$STATE/gaveup"
ensure_supervisors
log "apply-verified"
lock_release
echo "RESULT=on"; echo "reason=verified"; echo "upstream=$up"
exit 0
