#!/bin/sh
# double-apply.sh [N] [outdir] — N iterations of apply → apply → check (double-apply + status
# fidelity). Asserts RESULT=on twice, mode=on, and exactly one keeper, guard and filter
# process. Process counting reads /proc/<pid>/cmdline: this TV's busybox `ps` prints only
# the first token ("sh") for shell-script processes, so `ps | grep '[k]eeper.sh'` counts 0
# there even when the supervisors are running (S4 T7 G1 finding). /proc is the reliable
# source and matches the method check.sh uses.
APP=/media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist
N="${1:-20}"; OUT="${2:-/tmp/s4-captures}"; mkdir -p "$OUT"
LOG="$OUT/double-apply.txt"; okc=0; i=1

count_proc() { # count_proc <cmdline-substring>: PIDs whose NUL-separated cmdline contains it
  n=0
  for d in /proc/[0-9]*; do
    [ "$d" = "/proc/$$" ] && continue
    [ -r "$d/cmdline" ] || continue
    c=$(tr '\0' ' ' < "$d/cmdline" 2>/dev/null)
    case "$c" in *"$1"*) n=$((n+1)) ;; esac
  done
  echo "$n"
}

while [ "$i" -le "$N" ]; do
  a1=$(sh "$APP/scripts/apply.sh" 2>&1 | sed -n '1,2p' | tr '\n' ' ')
  a2=$(sh "$APP/scripts/apply.sh" 2>&1 | sed -n '1,2p' | tr '\n' ' ')
  st=$(sh "$APP/scripts/check.sh" 2>/dev/null)
  mode=$(printf '%s\n' "$st" | sed -n 's/^mode=//p')
  kc=$(count_proc 'keeper.sh'); gc=$(count_proc 'guard.sh'); fc=$(count_proc 'dnscrypt-proxy')
  if printf '%s' "$a1" | grep -q 'RESULT=on' && printf '%s' "$a2" | grep -q 'RESULT=on' \
     && [ "$mode" = "on" ] && [ "$kc" -eq 1 ] && [ "$gc" -eq 1 ] && [ "$fc" -eq 1 ]; then
    okc=$((okc+1)); echo "iter=$i ok keepers=$kc guards=$gc filters=$fc" | tee -a "$LOG"
  else
    echo "iter=$i FAIL a1=[$a1] a2=[$a2] mode=$mode keepers=$kc guards=$gc filters=$fc" | tee -a "$LOG"
  fi
  i=$((i+1))
done
echo "fidelity=$okc/$N" | tee -a "$LOG"
[ "$okc" -eq "$N" ]
