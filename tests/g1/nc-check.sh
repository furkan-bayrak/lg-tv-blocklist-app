#!/bin/sh
# nc-check.sh — prove the dnsq.sh nc fallback engages on THIS device.
# dnsq.sh takes the nc branch only when `command -v node` FAILS (node-absence
# trigger); that branch's proof marker is the exact string " (nc)" emitted as
# `rcode=<n> (nc)`. PATH tricks that merely remove one node directory are not
# reliable (node may share a core dir with nc/od/awk), so this builds a
# sanitized tool PATH of symlinks that provably contains NO node and runs
# dnsq.sh through it. No marker ⇒ explicit NOTE + exit 1, never a silent pass.
# Exit 0 = nc fallback proven engaged; 1 = not exercised / inconclusive.
APP="${LGTVB_APP:-/media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist}"
SHB=$(command -v sh 2>/dev/null) || SHB=/bin/sh
echo "node=$(command -v node || echo none) nc=$(command -v nc || echo none) od=$(command -v od || echo none) awk=$(command -v awk || echo none)"

B=$(mktemp -d /tmp/s4-ncbin.XXXXXX 2>/dev/null) || B="${TMPDIR:-/tmp}/s4-ncbin.$$"
mkdir -p "$B" || { echo "NOTE: fallback not exercised (cannot create $B)"; exit 1; }
trap 'rm -rf "$B"' EXIT

# sanitized tool PATH: link in exactly the tools dnsq.sh's nc branch needs —
# node is deliberately absent, so its absence is enforced, not assumed.
for t in nc od awk; do
  p=$(command -v "$t" 2>/dev/null) || p=""
  case "$p" in
    /*) ln -s "$p" "$B/$t" 2>/dev/null || cp -f "$p" "$B/$t" 2>/dev/null ;;
    "") ;;
    *)  bb=$(command -v busybox 2>/dev/null)   # bare applet name (standalone shell)
        [ -n "$bb" ] && ln -s "$bb" "$B/$t" 2>/dev/null ;;
  esac
done
if [ ! -e "$B/nc" ] || [ ! -e "$B/od" ]; then
  echo "NOTE: fallback not exercised (nc/od not stubbable into a node-free PATH)"
  exit 1
fi
if [ -e "$B/node" ]; then
  echo "NOTE: fallback not exercised (node leaked into sanitized PATH)"
  exit 1
fi
# belt+braces: node must not be resolvable inside the sanitized environment
NOUT=$(env PATH="$B" "$SHB" -c 'command -v node' 2>/dev/null) || NOUT=""
if [ -n "$NOUT" ]; then
  echo "NOTE: fallback not exercised (node still resolvable: $NOUT)"
  exit 1
fi

echo "== fallback live test (sanitized PATH, provably node-free: $B) =="
OUT=$(env PATH="$B" "$SHB" "$APP/scripts/dnsq.sh" example.com 127.0.0.1 5335 2>&1)
rc=$?
printf '%s\n' "$OUT"
echo "rc=$rc"
case "$OUT" in
  *' (nc)'*)
    echo "PROOF: nc fallback engaged (marker ' (nc)' present)"
    exit 0 ;;
esac
echo "NOTE: fallback not exercised (no ' (nc)' marker in dnsq.sh output)"
exit 1
