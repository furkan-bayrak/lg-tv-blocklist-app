#!/bin/sh
# tier.sh — set the active tier (SAFE|STRICT). Fixed entrypoint: exactly one
# argument, and it must be the literal 'safe' or 'strict'; anything else exits
# non-zero WITHOUT touching the state. The UI only ever sends those two
# constants (src/bridge.ts holds both command strings verbatim), and this check
# is what keeps that true if the wrapper set ever changes.
#
# It writes one root-only state key and nothing else: 'tier'. Making a tier
# change actually take effect is the EXISTING apply path — materialize_config
# copies that tier's bundled list and the filter restarts — so the UI calls
# runApply() after this when protection is on. tier.sh never touches the
# firewall, the pointer, the filter, the lock or the journal's protection
# stages, so a tier change can never turn protection on (or off) by itself.
#
# Usage: sh tier.sh safe|strict
# Exit:  0 = written · 2 = bad usage (nothing written) · 1 = state write failed
SELF=$(readlink -f "$0" 2>/dev/null); [ -n "$SELF" ] || SELF="$0"
SELF_DIR=${SELF%/*}
. "$SELF_DIR/common.sh"

if [ "$#" -ne 1 ]; then
  echo "tier.sh: expected exactly one argument: safe|strict" >&2
  exit 2
fi
case "$1" in
  safe|strict) tier_want=$1 ;;
  *)
    echo "tier.sh: refusing an unknown tier (expected safe|strict)" >&2
    exit 2
    ;;
esac

ensure_state
log "tier-set tier=$tier_want"
state_set tier "$tier_want"

# Read-back, not trust: a tier change that did not stick must never look like
# success — the UI re-applies protection on the strength of this exit code, and
# a silent failure would leave the panel claiming a tier the box is not on.
if [ "$(state_get tier)" != "$tier_want" ]; then
  echo "tier.sh: state write failed" >&2
  exit 1
fi

# Fixed machine-readable result, same two-key shape as apply.sh/rollback.sh. The
# UI never parses this as a message (it shows it as raw output only) — the tier
# it renders comes from the live-probed status block.
echo "RESULT=tier"
echo "reason=$tier_want"
exit 0
