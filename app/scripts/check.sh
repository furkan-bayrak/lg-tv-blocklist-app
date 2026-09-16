#!/bin/sh
# check.sh — live status probe. Fixed entrypoint, no args. Prints exactly one
# @@STATUS-BEGIN/@@STATUS-END block (schema 2, 14 keys). Read-only, fast, root-only friendly.
SELF=$(readlink -f "$0" 2>/dev/null); [ -n "$SELF" ] || SELF="$0"
SELF_DIR=${SELF%/*}
. "$SELF_DIR/common.sh"

# ---- PROBE ----
ts=$(date +%s)

hook=missing
hook_target=none
if [ -L "$HOOK_LINK" ]; then
  tgt=$(readlink "$HOOK_LINK" 2>/dev/null)
  hook=other
  if [ -n "$tgt" ] && [ "${tgt#/}" != "$tgt" ] && [ -z "$(printf '%s' "$tgt" | tr -d 'A-Za-z0-9/._-')" ]; then
    hook_target=$tgt
    # linked = the symlink resolves to OUR boot.sh (schema semantics: "ours");
    # any other existing target stays 'other' — never claim ours when it is not.
    if [ -f "$tgt" ] && [ "$tgt" = "$SELF_DIR/boot.sh" ]; then hook=linked; fi
  else
    hook_target=none
  fi
fi

scripts=missing
[ -f "$SELF_DIR/boot.sh" ] && [ -f "$SELF_DIR/check.sh" ] && scripts=ok

filter=down
filter_running && filter=up

cap_probe
rule=absent
if [ "$CAP" = "dnat" ]; then
  up=$(state_get upstream)
  if [ -n "$up" ] && rules_present "$up"; then rule=on; else rule=off; fi
fi

keeper=down; keeper_running && keeper=up
guard=down;  guard_running  && guard=up

pointer=$(state_get pointer)
case "$pointer" in on) ;; *) pointer=off ;; esac
gaveup=no;  [ -f "$STATE/gaveup" ] && gaveup=yes
upstream=$(state_get upstream)
[ -n "$upstream" ] || upstream=none
if [ "$upstream" != "none" ] && ! is_ipv4 "$upstream"; then upstream=none; fi
cap="$CAP"

if [ "$cap" = "dnat" ]; then
  if [ "$rule" = "on" ] && [ "$filter" = "up" ]; then mode=on; else mode=off; fi
else
  mode=degraded
fi

# ---- VERIFY ----
# (shape is fixed by construction; the app-side strict parser is the verify gate)

# ---- COMMIT ----
echo '@@STATUS-BEGIN'
echo "schema=2"
echo "ts=$ts"
echo "hook=$hook"
echo "hook_target=$hook_target"
echo "scripts=$scripts"
echo "filter=$filter"
echo "rule=$rule"
echo "keeper=$keeper"
echo "guard=$guard"
echo "pointer=$pointer"
echo "gaveup=$gaveup"
echo "mode=$mode"
echo "upstream=$upstream"
echo "cap=$cap"
echo '@@STATUS-END'
exit 0
