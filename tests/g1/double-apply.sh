#!/bin/sh
# double-apply.sh [N] [outdir] — N iterations of apply → apply → check (double-apply + status
# fidelity). Asserts RESULT=on twice, mode=on, exactly one keeper and one guard process.
APP=/media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist
N="${1:-20}"; OUT="${2:-/tmp/s4-captures}"; mkdir -p "$OUT"
LOG="$OUT/double-apply.txt"; okc=0; i=1
while [ "$i" -le "$N" ]; do
  a1=$(sh "$APP/scripts/apply.sh" 2>&1 | sed -n '1,2p' | tr '\n' ' ')
  a2=$(sh "$APP/scripts/apply.sh" 2>&1 | sed -n '1,2p' | tr '\n' ' ')
  st=$(sh "$APP/scripts/check.sh" 2>/dev/null)
  mode=$(printf '%s\n' "$st" | sed -n 's/^mode=//p')
  kc=$(ps | grep '[k]eeper.sh' | wc -l); gc=$(ps | grep '[g]uard.sh' | wc -l)
  if printf '%s' "$a1" | grep -q 'RESULT=on' && printf '%s' "$a2" | grep -q 'RESULT=on' \
     && [ "$mode" = "on" ] && [ "$kc" -eq 1 ] && [ "$gc" -eq 1 ]; then
    okc=$((okc+1)); echo "iter=$i ok keepers=$kc guards=$gc" | tee -a "$LOG"
  else
    echo "iter=$i FAIL a1=[$a1] a2=[$a2] mode=$mode keepers=$kc guards=$gc" | tee -a "$LOG"
  fi
  i=$((i+1))
done
echo "fidelity=$okc/$N" | tee -a "$LOG"
[ "$okc" -eq "$N" ]
