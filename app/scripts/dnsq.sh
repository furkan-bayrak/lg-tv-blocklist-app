#!/bin/sh
# dnsq.sh <name> [server] [port] — query helper (Node path; nc fallback).
# Exit: 0 NOERROR, 2 rcode!=0, 1 timeout/failure.
# No-server default = 127.0.0.1:53 — the TV's stub resolver path: DNAT captures
# it while the filter rules are on; normal resolution while off.
SELF=$(readlink -f "$0" 2>/dev/null)
[ -n "$SELF" ] || SELF="$0"
SELF_DIR=${SELF%/*}
NAME="$1"; SRV="${2:-127.0.0.1}"; PORT="${3:-53}"
if command -v node >/dev/null 2>&1; then exec node "$SELF_DIR/dnsq.js" "$NAME" "$SRV" "$PORT"; fi
q() {
  printf '\022\064\001\000\000\001\000\000\000\000\000\000'
  IFS=.
  for l in $1; do printf "\\$(printf '%03o' ${#l})"; printf '%s' "$l"; done
  printf '\000\000\001\000\001'
}
ANS=$(q "$NAME" | nc -u -w 3 "$SRV" "$PORT" 2>/dev/null | od -An -tx1 | head -3)
[ -n "$ANS" ] || { echo 'TIMEOUT'; exit 1; }
echo "hex: $ANS"     # manual read: DNS rcode = low nibble of byte index 3 (REFUSED = 05)
exit 2
