#!/bin/sh
# run-all.sh [outdir] — runs F,K,FK,KF,BOTH with an ON restore between scenarios.
# Owner of TV must be idle; ends with mode=on. Fails fast on restore failure.
APP=/media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist
DIR=$(dirname "$0"); OUT="${1:-/tmp/s4-captures}"; mkdir -p "$OUT"
SUM="$OUT/matrix-summary.txt"; : > "$SUM"

for s in F K FK KF BOTH; do
  echo "### $s start $(date '+%F %T')" | tee -a "$SUM"
  sh "$DIR/kill-matrix.sh" "$s" "$OUT" > "$OUT/run-$s.log" 2>&1
  rc=$?
  tail -n 3 "$OUT/run-$s.log" | tee -a "$SUM"
  echo "### $s matrix-exit=$rc" | tee -a "$SUM"
  # restore ON for the next scenario
  a=$(sh "$APP/scripts/apply.sh" 2>&1 | sed -n '1,3p')
  printf 'restore[%s]: %s\n' "$s" "$(printf '%s' "$a" | tr '\n' ' ')" | tee -a "$SUM"
  m=$(sh "$APP/scripts/check.sh" 2>/dev/null | sed -n 's/^mode=//p')
  [ "$m" = "on" ] || { echo "RESTORE-FAIL $s (mode=$m)"; exit 1; }
  sleep "${SPACING:-5}"
done
echo "== run-all complete ==" | tee -a "$SUM"
