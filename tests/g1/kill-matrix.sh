#!/bin/sh
# kill-matrix.sh <F|K|FK|KF|BOTH> [outdir] — S4 kill-matrix scenario driver (G1, app build).
# Kills per scenario, polls system DNS every second, waits for the app's terminal convergence
# (check.sh) up to 90 s, then prints a parsable RESULT line. NEVER repairs externally.
# Exit 0 = scenario met its S4 criteria; 1 = failed/skipped.
APP=/media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist
STATE=/var/lib/webosbrew/lg-tv-blocklist-app
SCEN="$1"; OUT="${2:-/tmp/s4-captures}"
KM_ITERS="${KM_ITERS:-90}"
mkdir -p "$OUT"
TL="$OUT/dark-$SCEN.timeline"; LOG="$OUT/matrix-$SCEN.txt"

status_keys() { sh "$APP/scripts/check.sh" 2>/dev/null; }
key() { status_keys | sed -n "s/^$1=//p"; }
now() { date +%s; }
poll() {
  i=0
  while [ "$i" -lt "$KM_ITERS" ]; do
    # sh-wrapped: IPK entry modes are 0666 (ares-package), never directly executable
    if sh "$APP/scripts/dnsq.sh" example.com 127.0.0.1 53 >/dev/null 2>&1; then
      echo "$(now) OK"
    else
      echo "$(now) FAIL"
    fi
    sleep 1; i=$((i+1))
  done
}

case "$SCEN" in F|K|FK|KF|BOTH) ;; *) echo "usage: $0 F|K|FK|KF|BOTH [outdir]"; exit 2 ;; esac
pre="$(status_keys)"
{
  echo "== pre ($SCEN) $(now) =="
  printf '%s\n' "$pre"
} | tee "$LOG"
[ "$(key mode)" = "on" ] || { echo "SKIP: mode!=on before scenario"; exit 1; }

poll > "$TL" & POLLER=$!
sleep 2
case "$SCEN" in
  F)    kill -9 "$(cat "$STATE/filter.pid" 2>/dev/null)" 2>/dev/null ;;
  K)    kill -9 "$(cat "$STATE/keeper.pid" 2>/dev/null)" 2>/dev/null ;;
  FK)   kill -9 "$(cat "$STATE/filter.pid" 2>/dev/null)" "$(cat "$STATE/keeper.pid" 2>/dev/null)" 2>/dev/null ;;
  KF)   kill -9 "$(cat "$STATE/keeper.pid" 2>/dev/null)" 2>/dev/null
        sleep 1
        kill -9 "$(cat "$STATE/filter.pid" 2>/dev/null)" 2>/dev/null ;;
  BOTH) kill -9 "$(cat "$STATE/filter.pid" 2>/dev/null)" "$(cat "$STATE/keeper.pid" 2>/dev/null)" 2>/dev/null ;;
esac

t0=$(now); done_=0; i=0
# one check.sh snapshot per second (never per-field — each call spawns processes)
while [ "$i" -lt 90 ]; do
  st1="$(status_keys)"
  f=$(printf '%s\n' "$st1" | sed -n 's/^filter=//p'); r=$(printf '%s\n' "$st1" | sed -n 's/^rule=//p')
  g=$(printf '%s\n' "$st1" | sed -n 's/^gaveup=//p'); m=$(printf '%s\n' "$st1" | sed -n 's/^mode=//p')
  case "$SCEN" in
    F)            [ "$f" = "up" ] && [ "$r" = "on" ] && [ "$g" = "no" ] && { done_=1; break; } ;;
    K|FK|KF|BOTH) [ "$g" = "yes" ] && [ "$m" = "off" ] && { done_=1; break; } ;;
  esac
  sleep 1; i=$((i+1))
done
t1=$(now); wait "$POLLER" 2>/dev/null
conv=$((t1 - t0))
dark=$(grep -c FAIL "$TL" 2>/dev/null || true); [ -n "$dark" ] || dark=0
recovered=$(awk 'prev=="FAIL" && $2=="OK" {r=$1} {prev=$2} END{if (r!="") print r}' "$TL")
post="$(status_keys)"
{
  echo "== post ($SCEN) $(now) =="
  printf '%s\n' "$post"
} | tee -a "$LOG"

res=1
case "$SCEN" in
  F)
    [ "$done_" = 1 ] && [ "$conv" -le 60 ] && res=0 ;;
  K)
    [ "$done_" = 1 ] && [ "$conv" -le 30 ] && res=0 ;;
  FK|KF|BOTH)
    [ "$done_" = 1 ] && [ "$conv" -le 60 ] && res=0 ;;
esac
stf="$(status_keys)"
f=$(printf '%s\n' "$stf" | sed -n 's/^filter=//p'); r=$(printf '%s\n' "$stf" | sed -n 's/^rule=//p')
g=$(printf '%s\n' "$stf" | sed -n 's/^gaveup=//p'); m=$(printf '%s\n' "$stf" | sed -n 's/^mode=//p')
k=$(printf '%s\n' "$stf" | sed -n 's/^keeper=//p'); gd=$(printf '%s\n' "$stf" | sed -n 's/^guard=//p')
echo "RESULT scen=$SCEN converge_s=$conv dark_samples=$dark recovered_at=${recovered:-none} done=$done_ filter=$f rule=$r keeper=$k guard=$gd gaveup=$g mode=$m" | tee -a "$LOG"
exit $res
