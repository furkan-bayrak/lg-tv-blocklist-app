#!/bin/sh
# nc-check.sh — prove a node-free DNS query path works on THIS device (T4/T7
# "canaries node-optional"). Node is hidden from PATH (sanitized symlink dir,
# enforced not assumed). Methods, in order:
#   1) dnsq.sh's nc branch — proof marker is the exact string " (nc)" emitted as
#      `rcode=<n> (nc)`; it engages only when `command -v node` FAILS.
#   2) busybox `nslookup <name> <server>:<port>` — proof: a positive lookup.
# G1 finding 2026-10-01: its busybox `nc` is the minimal TCP-only applet
# (`nc [IPADDR PORT]`, no -u), so method 1 cannot engage there; method 2 is the
# G1-proven node-free path. The capture labels the method used (METHOD=...).
# Exit 0 only with definitive proof; otherwise exit 1 + NOTE. Never a silent pass.
APP="${LGTVB_APP:-/media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist}"
SHB=$(command -v sh 2>/dev/null) || SHB=/bin/sh
echo "node=$(command -v node || echo none) nc=$(command -v nc || echo none) od=$(command -v od || echo none) awk=$(command -v awk || echo none) nslookup=$(command -v nslookup || echo none)"

B=$(mktemp -d /tmp/s4-ncbin.XXXXXX 2>/dev/null) || B="${TMPDIR:-/tmp}/s4-ncbin.$$"
mkdir -p "$B" || { echo "NOTE: fallback not exercised (cannot create $B)"; exit 1; }
trap 'rm -rf "$B"' EXIT

# sanitized tool PATH: link in exactly the fallback tools — node is deliberately
# absent, so its absence is enforced, not assumed.
for t in nc od awk nslookup; do
  p=$(command -v "$t" 2>/dev/null) || p=""
  case "$p" in
    /*) ln -s "$p" "$B/$t" 2>/dev/null || cp -f "$p" "$B/$t" 2>/dev/null ;;
    "") ;;
    *)  bb=$(command -v busybox 2>/dev/null)   # bare applet name (standalone shell)
        [ -n "$bb" ] && ln -s "$bb" "$B/$t" 2>/dev/null ;;
  esac
done
# belt+braces: node must not be resolvable inside the sanitized environment
NOUT=$(env PATH="$B" "$SHB" -c 'command -v node' 2>/dev/null) || NOUT=""
if [ -n "$NOUT" ]; then
  echo "NOTE: fallback not exercised (node still resolvable: $NOUT)"
  exit 1
fi

echo "== stage 1: dnsq.sh nc branch (sanitized PATH, provably node-free: $B) =="
if [ -e "$B/nc" ] && [ -e "$B/od" ]; then
  OUT=$(env PATH="$B" "$SHB" "$APP/scripts/dnsq.sh" example.com 127.0.0.1 5335 2>&1)
  rc=$?
  printf '%s\n' "$OUT"
  echo "rc=$rc"
  case "$OUT" in
    *' (nc)'*)
      echo "PROOF: node-free path verified; METHOD=dnsq-nc"
      exit 0 ;;
  esac
  echo "NOTE: dnsq.sh nc branch did not engage on this device (no ' (nc)' marker)"
else
  echo "NOTE: dnsq.sh nc branch not testable here (nc/od not stubbable into the sanitized PATH)"
fi

echo "== stage 2: busybox nslookup (sanitized PATH, provably node-free: $B) =="
if [ -e "$B/nslookup" ]; then
  OUT=$(env PATH="$B" "$SHB" -c 'nslookup example.com 127.0.0.1:5335' 2>&1)
  rc=$?
  printf '%s\n' "$OUT"
  echo "rc=$rc"
  case "$OUT" in
    *"Name:"*)
      echo "PROOF: node-free path verified; METHOD=busybox-nslookup (nslookup example.com 127.0.0.1:5335)"
      exit 0 ;;
  esac
  echo "NOTE: nslookup branch produced no positive answer"
else
  echo "NOTE: nslookup not stubbable into the sanitized PATH"
fi

echo "NOTE: fallback not exercised (no node-free query path could be proven)"
exit 1
