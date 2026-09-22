#!/bin/sh
# tests/shell/run-tests.sh — sandbox tests for app/scripts/check.sh (Slice S2; schema 2 in S3 T5),
# app/scripts/apply.sh + rollback.sh (Slice S3, T3),
# app/scripts/keeper.sh + guard.sh (Slice S3, T4) and
# app/scripts/boot.sh (Slice S3, T5).
#
# Run from anywhere:  sh tests/shell/run-tests.sh
# CI (ubuntu) runs this after the build step. Locally use any POSIX shell
# (Windows: Git Bash or WSL — CI is authoritative).
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
CHECK="$REPO/app/scripts/check.sh"
SH="$(command -v sh || true)"
[ -n "$SH" ] || SH=/bin/sh

pass=0
fail=0
ok() { pass=$((pass + 1)); printf 'PASS: %s\n' "$1"; }
no() { fail=$((fail + 1)); printf 'FAIL: %s — %s\n' "$1" "$2"; }

norm() { sed 's/^ts=[0-9][0-9]*$/ts=<TS>/'; }

# --- suite-wide daemon cleanup ------------------------------------------------
# Every sandbox lives under this root so cleanup_all can find all pid files.
# Without this, run_bg-spawned keeper/guard daemons survive the suite (they are
# reparented to init) and their orphans accumulate / hold the caller's terminal.
SB_ROOT="$(mktemp -d)" 2>/dev/null || SB_ROOT=""
if [ -z "$SB_ROOT" ]; then
  printf 'FATAL: cannot create sandbox root\n' >&2
  exit 1
fi

# ps_scan — pids of keeper/guard processes whose command line references this
# run's sandbox root. Works on Git Bash and Ubuntu CI: `ps -ef` (PID = field 2)
# first, plain `ps` (PID = field 1) as fallback. The bracket trick
# ([k]eeper\.sh|[g]uard\.sh) keeps the script-name grep from matching its own
# command line, and the -F SB_ROOT filter keeps it from matching anything
# outside the sandboxes (the suite's own argv has no SB_ROOT).
ps_scan() {
  [ -n "${SB_ROOT:-}" ] || return 0
  if ps_out="$(ps -ef 2>/dev/null)" && [ -n "$ps_out" ]; then
    printf '%s\n' "$ps_out" \
      | grep -F -- "$SB_ROOT" \
      | grep -E '[k]eeper\.sh|[g]uard\.sh' \
      | awk '{print $2}'
  else
    ps_out="$(ps 2>/dev/null || true)"
    printf '%s\n' "$ps_out" \
      | grep -F -- "$SB_ROOT" \
      | grep -E '[k]eeper\.sh|[g]uard\.sh' \
      | awk '{print $1}'
  fi
}

pidfile_pids() {  # pids recorded in every sandbox's keeper/guard pid files
  [ -n "${SB_ROOT:-}" ] && [ -d "$SB_ROOT" ] || return 0
  for f in "$SB_ROOT"/*/state/keeper.pid "$SB_ROOT"/*/state/guard.pid; do
    [ -f "$f" ] || continue
    p="$(cat "$f" 2>/dev/null || true)"
    [ -n "$p" ] && printf '%s\n' "$p"
  done
}

alive_count() {  # number of matching keeper/guard processes still alive
  n=0
  for p in $(pidfile_pids) $(ps_scan); do
    [ -n "$p" ] || continue
    if kill -0 "$p" 2>/dev/null; then n=$((n+1)); fi
  done
  printf '%s' "$n"
}

cleanup_all() {
  [ "${CLEANED:-0}" = "1" ] && return 0
  CLEANED=1
  reaped=0
  r=0
  while [ "$r" -lt 3 ]; do
    r=$((r+1))
    # keeper pid files FIRST — keeper respawns guards
    for f in "$SB_ROOT"/*/state/keeper.pid; do
      [ -f "$f" ] || continue
      p="$(cat "$f" 2>/dev/null || true)"
      [ -n "$p" ] || continue
      if kill -0 "$p" 2>/dev/null; then
        kill -9 "$p" 2>/dev/null && reaped=$((reaped+1))
      fi
    done
    # then guard pid files
    for f in "$SB_ROOT"/*/state/guard.pid; do
      [ -f "$f" ] || continue
      p="$(cat "$f" 2>/dev/null || true)"
      [ -n "$p" ] || continue
      if kill -0 "$p" 2>/dev/null; then
        kill -9 "$p" 2>/dev/null && reaped=$((reaped+1))
      fi
    done
    # then any straggler whose cmdline references this run's sandbox root
    for p in $(ps_scan); do
      [ -n "$p" ] || continue
      if kill -0 "$p" 2>/dev/null; then
        kill -9 "$p" 2>/dev/null && reaped=$((reaped+1))
      fi
    done
    sleep 0.3
    [ "$(alive_count)" = "0" ] && break
  done
  survivors="$(alive_count)"
  if [ "$survivors" = "0" ]; then
    printf 'CLEANUP: ok (reaped %s, survivors 0)\n' "$reaped"
  else
    printf 'CLEANUP: FAIL — %s survivor(s)\n' "$survivors"
  fi
  [ -n "${SB_ROOT:-}" ] && [ -d "$SB_ROOT" ] && rm -rf "$SB_ROOT"
  [ "$survivors" != "0" ] && exit 1
  return 0
}

on_signal() { cleanup_all; exit 130; }
trap cleanup_all EXIT
trap on_signal INT TERM

new_sandbox() {
  SB="$(mktemp -d "$SB_ROOT/sb.XXXXXX")"
  mkdir -p "$SB/appdir/scripts" "$SB/hookdir"
  cp "$CHECK" "$REPO/app/scripts/common.sh" "$SB/appdir/scripts/"
  : > "$SB/appdir/scripts/boot.sh"
  chmod +x "$SB/appdir/scripts/check.sh"
}

run_check() {  # run_check <hook_dir> [PATH]; default PATH has no iptables (cap=unsupported)
  p="${2:-/usr/bin:/bin}"
  env PATH="$p" LGTVB_HOOK_DIR="$1" "$SH" "$SB/appdir/scripts/check.sh" 2>"$SB/stderr"
}

assert_block() {  # assert_block <name> <expected block>
  name="$1"
  expected="$(printf '%s' "$2" | norm)"
  actual="$(printf '%s' "$OUT" | norm)"
  if [ "$RC" -ne 0 ]; then
    no "$name" "exit code $RC"
    return
  fi
  if [ "$actual" != "$expected" ]; then
    no "$name" "stdout mismatch"
    printf '%s\n' "--- expected ---" "$expected" "--- actual ---" "$actual"
    return
  fi
  ok "$name"
}

# --- Case 1: happy path — hook linked to our boot.sh -------------------------
new_sandbox
ln -s "$SB/appdir/scripts/boot.sh" "$SB/hookdir/50-lgtv-blocklist-app"
OUT="$(run_check "$SB/hookdir")"; RC=$?
assert_block "happy path (hook linked)" "@@STATUS-BEGIN
schema=2
ts=<TS>
hook=linked
hook_target=$SB/appdir/scripts/boot.sh
scripts=ok
filter=down
rule=absent
keeper=down
guard=down
pointer=off
gaveup=no
mode=degraded
upstream=none
cap=unsupported
@@STATUS-END"
if [ -s "$SB/stderr" ]; then no "happy path stderr empty" "stderr not empty"; else ok "happy path stderr empty"; fi

# --- Case 2: hook directory does not exist -----------------------------------
new_sandbox
OUT="$(run_check "$SB/absent-hook-dir")"; RC=$?
assert_block "missing hook dir" "@@STATUS-BEGIN
schema=2
ts=<TS>
hook=missing
hook_target=none
scripts=ok
filter=down
rule=absent
keeper=down
guard=down
pointer=off
gaveup=no
mode=degraded
upstream=none
cap=unsupported
@@STATUS-END"

# --- Case 3: symlink points somewhere else -----------------------------------
new_sandbox
ln -s /tmp/foreign-target "$SB/hookdir/50-lgtv-blocklist-app"
OUT="$(run_check "$SB/hookdir")"; RC=$?
assert_block "foreign symlink" "@@STATUS-BEGIN
schema=2
ts=<TS>
hook=other
hook_target=/tmp/foreign-target
scripts=ok
filter=down
rule=absent
keeper=down
guard=down
pointer=off
gaveup=no
mode=degraded
upstream=none
cap=unsupported
@@STATUS-END"

# --- Case 4: hostile target (newline + fake delimiters) ----------------------
new_sandbox
ln -s "$(printf 'evil\n@@STATUS-END\nhook=linked')" "$SB/hookdir/50-lgtv-blocklist-app"
OUT="$(run_check "$SB/hookdir")"; RC=$?
assert_block "hostile target sanitized" "@@STATUS-BEGIN
schema=2
ts=<TS>
hook=other
hook_target=none
scripts=ok
filter=down
rule=absent
keeper=down
guard=down
pointer=off
gaveup=no
mode=degraded
upstream=none
cap=unsupported
@@STATUS-END"
linecount="$(printf '%s\n' "$OUT" | wc -l | tr -d ' ')"
if [ "$linecount" = "16" ]; then ok "hostile target keeps block at 16 lines"; else no "hostile target keeps block at 16 lines" "got $linecount"; fi

# --- Case 5: stub PATH — broken readlink (symlink present but unreadable) -----
new_sandbox
ln -s "$SB/appdir/scripts/boot.sh" "$SB/hookdir/50-lgtv-blocklist-app"
mkdir -p "$SB/stub-bin"
cp "$HERE/stub-bin/readlink" "$SB/stub-bin/readlink"
chmod +x "$SB/stub-bin/readlink"
OUT="$(run_check "$SB/hookdir" "$SB/stub-bin:/usr/bin:/bin")"; RC=$?
assert_block "stub PATH fallback (readlink broken)" "@@STATUS-BEGIN
schema=2
ts=<TS>
hook=other
hook_target=none
scripts=ok
filter=down
rule=absent
keeper=down
guard=down
pointer=off
gaveup=no
mode=degraded
upstream=none
cap=unsupported
@@STATUS-END"

# --- Case 6: scripts missing (boot.sh removed) -------------------------------
new_sandbox
rm "$SB/appdir/scripts/boot.sh"
OUT="$(run_check "$SB/hookdir")"; RC=$?
assert_block "scripts missing" "@@STATUS-BEGIN
schema=2
ts=<TS>
hook=missing
hook_target=none
scripts=missing
filter=down
rule=absent
keeper=down
guard=down
pointer=off
gaveup=no
mode=degraded
upstream=none
cap=unsupported
@@STATUS-END"

# ==================== S3 T3: apply.sh / rollback.sh sandbox ====================
SCRIPTS_SRC="$REPO/app/scripts"
FILTER_SRC="$REPO/app/filter"
STUBBIN="$HERE/stub-bin"
BASE_PATH="$PATH"

new_app_sandbox() {
  SB="$(mktemp -d "$SB_ROOT/sb.XXXXXX")"
  mkdir -p "$SB/appdir/scripts" "$SB/appdir/filter" "$SB/hookdir" "$SB/state" "$SB/bin"
  cp "$SCRIPTS_SRC/common.sh" "$SCRIPTS_SRC/apply.sh" "$SCRIPTS_SRC/rollback.sh" "$SCRIPTS_SRC/keeper.sh" "$SCRIPTS_SRC/guard.sh" "$SCRIPTS_SRC/check.sh" "$SCRIPTS_SRC/boot.sh" "$SB/appdir/scripts/"
  cp "$FILTER_SRC/dnscrypt-proxy.toml.template" "$FILTER_SRC/forward-rules.txt.template" "$FILTER_SRC/filter-input.txt" "$SB/appdir/filter/"
  cp "$STUBBIN/iptables" "$STUBBIN/luna-send" "$STUBBIN/dnsq" "$STUBBIN/fake-dnscrypt-proxy" "$STUBBIN/fake-dnscrypt-proxy-dead" "$SB/bin/"
  chmod +x "$SB/appdir/scripts/apply.sh" "$SB/appdir/scripts/rollback.sh" "$SB/appdir/scripts/keeper.sh" "$SB/appdir/scripts/guard.sh" "$SB/appdir/scripts/check.sh" "$SB/appdir/scripts/boot.sh" "$SB/bin/iptables" "$SB/bin/luna-send" "$SB/bin/dnsq" "$SB/bin/fake-dnscrypt-proxy" "$SB/bin/fake-dnscrypt-proxy-dead"
  # probe.sh — sources common.sh with the same $0-based paths as the app scripts,
  # so the suite can call helpers directly (state_get, cmdline_has, stamp,
  # materialize) instead of only through the fixed entrypoints.
  printf '%s\n' \
    'SELF=$(readlink -f "$0" 2>/dev/null); [ -n "$SELF" ] || SELF="$0"' \
    'SELF_DIR=${SELF%/*}' \
    '. "$SELF_DIR/common.sh"' \
    'case ${1:-} in' \
    '  state_get) shift; state_get "$1"; echo "rc=$?" ;;' \
    '  cmdline_has) shift; cmdline_has "$1" "$2"; echo "rc=$?" ;;' \
    '  materialize) shift; materialize_config "$1"; echo "rc=$?" ;;' \
    '  stamp) shift; s=$(dns_stamp_upstream "$1"); rc=$?; printf "%s\nrc=%s\n" "$s" "$rc" ;;' \
    'esac' \
    > "$SB/appdir/scripts/probe.sh"
  chmod +x "$SB/appdir/scripts/probe.sh"
  TEST_LOG="$SB/test.log"; : > "$TEST_LOG"
  TEST_IPT_STATE="$SB/ipt.state"; : > "$TEST_IPT_STATE"
  TEST_DNSQ_NAME_RC="$SB/dnsq-name-rc"; : > "$TEST_DNSQ_NAME_RC"
  TEST_DNSQ_SERVER_RC="$SB/dnsq-server-rc"; : > "$TEST_DNSQ_SERVER_RC"
  printf 'DNAT\n' > "$SB/targets"
  DNSQ_RC=0
  KEEPER_PID=""; GUARD_PID=""; FILTER_STUB_BIN=""; TEST_LUNA_FILE=""
}

run_app() {  # run_app <script-name>; sets OUT + RC (env-only, no args to scripts)
  OUT="$(env PATH="$SB/bin:$BASE_PATH" \
    LGTVB_STATE_DIR="$SB/state" LGTVB_HOOK_DIR="$SB/hookdir" \
    LGTVB_DNSQ="$SB/bin/dnsq" LGTVB_FILTER_BIN="$SB/bin/fake-dnscrypt-proxy" \
    LGTVB_TICK=1 LGTVB_GUARD_TICK=1 LGTVB_TARGETS_FILE="$SB/targets" \
    TEST_LOG="$TEST_LOG" TEST_IPT_STATE="$TEST_IPT_STATE" \
    TEST_DNSQ_NAME_RC="$TEST_DNSQ_NAME_RC" TEST_DNSQ_SERVER_RC="$TEST_DNSQ_SERVER_RC" \
    TEST_DNSQ_RC="$DNSQ_RC" \
    "$SH" "$SB/appdir/scripts/$1" 2>"$SB/stderr")"
  RC=$?
}

assert_result() {  # assert_result <name> <RESULT-value> <reason-value>
  if [ "$RC" -ne 0 ]; then no "$1" "exit code $RC"; return; fi
  l1="$(printf '%s\n' "$OUT" | sed -n '1p')"
  l2="$(printf '%s\n' "$OUT" | sed -n '2p')"
  if [ "$l1" = "RESULT=$2" ] && [ "$l2" = "reason=$3" ]; then
    ok "$1"
  else
    no "$1" "got: [$l1] [$l2]"
  fi
}

chk_state() { grep -q -- "$1" "$SB/state/state" 2>/dev/null; }
chk_log() { grep -q -- "$1" "$TEST_LOG" 2>/dev/null; }
log_line() { grep -n -- "$1" "$TEST_LOG" 2>/dev/null | head -n1 | cut -d: -f1; }
ipt_stub() { env TEST_LOG="$TEST_LOG" TEST_IPT_STATE="$TEST_IPT_STATE" "$SB/bin/iptables" "$@"; }

cleanup_app_sandbox() {
  if [ -f "$SB/state/fake-pids" ]; then
    while read -r p; do kill -9 "$p" 2>/dev/null; done < "$SB/state/fake-pids"
  fi
  rm -rf "$SB"
}

# ==================== S3 T4: keeper.sh / guard.sh helpers ====================
run_bg() {  # run_bg <script> — background supervisor run; sets LAST_BG_PID
  env PATH="$SB/bin:$BASE_PATH" \
    LGTVB_STATE_DIR="$SB/state" LGTVB_HOOK_DIR="$SB/hookdir" \
    LGTVB_DNSQ="$SB/bin/dnsq" LGTVB_FILTER_BIN="${FILTER_STUB_BIN:-$SB/bin/fake-dnscrypt-proxy}" \
    LGTVB_TICK=1 LGTVB_GUARD_TICK=1 \
    LGTVB_BACKOFF=1 LGTVB_UWAIT_ROUNDS=2 LGTVB_UWAIT_SLEEP=1 LGTVB_GUARD_GRACE=2 \
    LGTVB_TARGETS_FILE="$SB/targets" \
    TEST_LOG="$TEST_LOG" TEST_IPT_STATE="$TEST_IPT_STATE" \
    TEST_DNSQ_NAME_RC="$TEST_DNSQ_NAME_RC" TEST_DNSQ_SERVER_RC="$TEST_DNSQ_SERVER_RC" \
    TEST_DNSQ_RC="$DNSQ_RC" TEST_LUNA_FILE="${TEST_LUNA_FILE:-}" \
    "$SH" "$SB/appdir/scripts/$1" >>"$SB/$1.out" 2>&1 </dev/null &
  LAST_BG_PID=$!
}

wait_for() {  # wait_for <file> <pattern> <max 0.2s iterations>; rc 1 on timeout
  n=0
  while [ "$n" -lt "$3" ]; do
    grep -q -- "$2" "$1" 2>/dev/null && return 0
    sleep 0.2; n=$((n+1))
  done
  return 1
}

wait_file() {  # wait_file <path> <max 0.2s iterations>; rc 1 on timeout
  n=0
  while [ "$n" -lt "$2" ]; do
    [ -e "$1" ] && return 0
    sleep 0.2; n=$((n+1))
  done
  return 1
}

jrnl() { grep -q -- "$1" "$SB/state/journal.log" 2>/dev/null; }

seed_rules() {  # seed_rules <upstream> — fake ruleset WITHOUT polluting TEST_LOG
  {
    echo "C nat LGTVBLK"
    echo "R nat LGTVBLK ! -d $1 -p udp --dport 53 -j DNAT --to-destination 127.0.0.1:5335"
    echo "R nat LGTVBLK ! -d $1 -p tcp --dport 53 -j DNAT --to-destination 127.0.0.1:5335"
    echo "R nat OUTPUT -j LGTVBLK"
    echo "C filter LGTVBLK-FILTER"
    echo "R filter LGTVBLK-FILTER -p tcp --dport 853 -j DROP"
    echo "R filter LGTVBLK-FILTER -p udp --dport 853 -j DROP"
    echo "R filter OUTPUT -j LGTVBLK-FILTER"
  } >> "$TEST_IPT_STATE"
}

start_fake_filter() {
  LGTVB_STATE_DIR="$SB/state" TEST_LOG="$TEST_LOG" "$SB/bin/fake-dnscrypt-proxy" -config "$SB/state/dnscrypt-proxy.toml" >> "$SB/state/filter.log" 2>&1 </dev/null &
  echo $! > "$SB/state/filter.pid"
  sleep 0.3
}

stop_t4() {  # kill keeper FIRST (no more guard respawns), then guards, then sandbox
  kp=$(cat "$SB/state/keeper.pid" 2>/dev/null || true)
  [ -n "$kp" ] && kill -9 "$kp" 2>/dev/null
  [ -n "${KEEPER_PID:-}" ] && kill -9 "$KEEPER_PID" 2>/dev/null
  gp=$(cat "$SB/state/guard.pid" 2>/dev/null || true)
  [ -n "$gp" ] && kill -9 "$gp" 2>/dev/null
  [ -n "${GUARD_PID:-}" ] && kill -9 "$GUARD_PID" 2>/dev/null
  sleep 0.3
  gp=$(cat "$SB/state/guard.pid" 2>/dev/null || true)
  [ -n "$gp" ] && kill -9 "$gp" 2>/dev/null
  cleanup_app_sandbox
}

make_dead_pid() {  # spawn + reap a process so DEAD_PID is a no-longer-alive pid
  sh -c 'exit 0' &
  DEAD_PID=$!
  wait "$DEAD_PID" 2>/dev/null || true
}

exit_check() {  # exit_check <name> <pid> <max 0.2s iterations> — process must be gone
  n=0
  while [ "$n" -lt "$3" ] && kill -0 "$2" 2>/dev/null; do sleep 0.2; n=$((n+1)); done
  if kill -0 "$2" 2>/dev/null; then no "$1" "still alive (pid $2)"; else ok "$1"; fi
}

# --- T3 Case 1: apply happy path ---------------------------------------------
new_app_sandbox
blocked="$(grep -m1 '^=' "$SB/appdir/filter/filter-input.txt" | cut -c2-)"
printf '%s 2\n' "$blocked" > "$TEST_DNSQ_NAME_RC"
run_app apply.sh
assert_result "apply happy path: on/verified" on verified
if printf '%s\n' "$OUT" | grep -q '^upstream=192.168.179.1$'; then ok "apply happy path: upstream echoed"; else no "apply happy path: upstream echoed" "OUT: $OUT"; fi
if chk_state '^pointer=on$'; then ok "apply happy path: pointer=on"; else no "apply happy path: pointer=on" "state: $(cat "$SB/state/state" 2>/dev/null)"; fi
if chk_state '^upstream=192.168.179.1$'; then ok "apply happy path: upstream stored"; else no "apply happy path: upstream stored" "state: $(cat "$SB/state/state" 2>/dev/null)"; fi
if chk_state '^cap=dnat$'; then ok "apply happy path: cap=dnat stored"; else no "apply happy path: cap=dnat stored" "state: $(cat "$SB/state/state" 2>/dev/null)"; fi
if chk_log '-t nat -N LGTVBLK'; then ok "apply happy path: nat chain created"; else no "apply happy path: nat chain created" "log: $(head -3 "$TEST_LOG")"; fi
if chk_log '! -d 192.168.179.1 -p udp --dport 53 -j DNAT --to-destination 127.0.0.1:5335'; then ok "apply happy path: udp DNAT rule"; else no "apply happy path: udp DNAT rule" "log: $(head -8 "$TEST_LOG")"; fi
if chk_log '! -d 192.168.179.1 -p tcp --dport 53 -j DNAT --to-destination 127.0.0.1:5335'; then ok "apply happy path: tcp DNAT rule"; else no "apply happy path: tcp DNAT rule" "log: $(head -8 "$TEST_LOG")"; fi
if chk_log '-t nat -I OUTPUT 1 -j LGTVBLK'; then ok "apply happy path: nat jump inserted"; else no "apply happy path: nat jump inserted" "log: $(head -8 "$TEST_LOG")"; fi
if chk_log '-I OUTPUT 1 -j LGTVBLK-FILTER'; then ok "apply happy path: filter jump inserted"; else no "apply happy path: filter jump inserted" "log: $(head -8 "$TEST_LOG")"; fi
if [ ! -e "$SB/state/gaveup" ]; then ok "apply happy path: no gaveup marker"; else no "apply happy path: no gaveup marker" "gaveup exists"; fi
if grep -q "stamp = 'sdns://AAAAAAAAAAAAEDE5Mi4xNjguMTc5LjE6NTM'" "$SB/state/dnscrypt-proxy.toml" 2>/dev/null; then ok "apply happy path: stamp generated for learned upstream"; else no "apply happy path: stamp generated for learned upstream" "$(tail -3 "$SB/state/dnscrypt-proxy.toml" 2>/dev/null)"; fi
if ! grep -q '192\.168\.179\.' "$SB/state/dnscrypt-proxy.toml" 2>/dev/null && ! grep -q '@STAMP@' "$SB/state/dnscrypt-proxy.toml" 2>/dev/null; then ok "apply happy path: no hardcoded IP / leftover token in config"; else no "apply happy path: no hardcoded IP / leftover token in config" "$(grep -n '192\.168\.179\.\|@STAMP@' "$SB/state/dnscrypt-proxy.toml" 2>/dev/null)"; fi
if grep -q '^\. 192\.168\.179\.1$' "$SB/state/forward-rules.txt" 2>/dev/null; then ok "apply happy path: forwarding rules use learned upstream"; else no "apply happy path: forwarding rules use learned upstream" "$(cat "$SB/state/forward-rules.txt" 2>/dev/null)"; fi
if [ ! -d "$SB/state/lock" ]; then ok "apply happy path: lock released"; else no "apply happy path: lock released" "lock dir present"; fi
cleanup_app_sandbox

# --- T3 Case 2: apply — side-port canary fails --------------------------------
new_app_sandbox
printf '127.0.0.1 1\n' > "$TEST_DNSQ_SERVER_RC"
run_app apply.sh
assert_result "apply sideport fail: fail/filter-sideport" fail filter-sideport
if ! chk_log 'DNAT'; then ok "apply sideport fail: no DNAT rules"; else no "apply sideport fail: no DNAT rules" "$(grep DNAT "$TEST_LOG")"; fi
if ! chk_log 'LGTVBLK'; then ok "apply sideport fail: no chains touched"; else no "apply sideport fail: no chains touched" "$(grep LGTVBLK "$TEST_LOG")"; fi
if [ ! -e "$SB/state/filter.pid" ]; then ok "apply sideport fail: filter.pid removed"; else no "apply sideport fail: filter.pid removed" "pid file exists"; fi
if ! chk_state '^pointer=on$'; then ok "apply sideport fail: pointer stays off"; else no "apply sideport fail: pointer stays off" "pointer=on found"; fi
cleanup_app_sandbox

# --- T3 Case 3: apply — blocked-check fails (dnsq rc 0 for blocked name) ------
new_app_sandbox
run_app apply.sh
assert_result "apply blocked fail: fail/verify-blocked" fail verify-blocked
addl="$(log_line '-t nat -A LGTVBLK .*--to-destination')"
dell="$(log_line '-t nat -D OUTPUT -j LGTVBLK')"
if [ -n "$addl" ] && [ -n "$dell" ] && [ "$addl" -lt "$dell" ]; then ok "apply blocked fail: rules add before teardown"; else no "apply blocked fail: rules add before teardown" "add=$addl del=$dell"; fi
xl="$(log_line '-t nat -X LGTVBLK')"
if [ -n "$dell" ] && [ -n "$xl" ] && [ "$dell" -lt "$xl" ]; then ok "apply blocked fail: teardown after add"; else no "apply blocked fail: teardown after add" "del=$dell x=$xl"; fi
if [ ! -e "$SB/state/filter.pid" ]; then ok "apply blocked fail: filter.pid removed"; else no "apply blocked fail: filter.pid removed" "pid file exists"; fi
if ! chk_state '^pointer=on$'; then ok "apply blocked fail: pointer stays off"; else no "apply blocked fail: pointer stays off" "pointer=on found"; fi
cleanup_app_sandbox

# --- T3 Case 4: apply — upstream unreachable ----------------------------------
new_app_sandbox
printf '192.168.179.1 1\n' > "$TEST_DNSQ_SERVER_RC"
run_app apply.sh
assert_result "apply upstream fail: fail/upstream-unreachable" fail upstream-unreachable
if ! chk_log 'filter-start'; then ok "apply upstream fail: filter not started"; else no "apply upstream fail: filter not started" "$(grep filter-start "$TEST_LOG")"; fi
if ! chk_log 'LGTVBLK'; then ok "apply upstream fail: no rules"; else no "apply upstream fail: no rules" "$(grep LGTVBLK "$TEST_LOG")"; fi
if [ ! -e "$SB/state/filter.pid" ]; then ok "apply upstream fail: no filter.pid"; else no "apply upstream fail: no filter.pid" "pid file exists"; fi
cleanup_app_sandbox

# --- T3 Case 5: apply — cap unsupported (iptables absent from PATH) -----------
new_app_sandbox
OUT="$(env PATH="/usr/bin:/bin" LGTVB_STATE_DIR="$SB/state" LGTVB_HOOK_DIR="$SB/hookdir" "$SH" "$SB/appdir/scripts/apply.sh" 2>"$SB/stderr")"
RC=$?
assert_result "apply cap unsupported: degraded/no-firewall-layer" degraded no-firewall-layer
if [ ! -f "$SB/state/state" ]; then ok "apply cap unsupported: no state written"; else no "apply cap unsupported: no state written" "state: $(cat "$SB/state/state")"; fi
if [ ! -e "$SB/state/gaveup" ]; then ok "apply cap unsupported: no gaveup"; else no "apply cap unsupported: no gaveup" "gaveup exists"; fi
if [ ! -s "$TEST_LOG" ]; then ok "apply cap unsupported: no iptables calls"; else no "apply cap unsupported: no iptables calls" "$(cat "$TEST_LOG")"; fi
cleanup_app_sandbox

# --- T3 Case 6: rollback — order: rules OFF before filter kill ----------------
new_app_sandbox
printf 'upstream=192.168.179.1\ncap=dnat\npointer=on\n' > "$SB/state/state"
ipt_stub -t nat -N LGTVBLK
ipt_stub -t nat -A LGTVBLK ! -d 192.168.179.1 -p udp --dport 53 -j DNAT --to-destination 127.0.0.1:5335
ipt_stub -t nat -A LGTVBLK ! -d 192.168.179.1 -p tcp --dport 53 -j DNAT --to-destination 127.0.0.1:5335
ipt_stub -t nat -I OUTPUT 1 -j LGTVBLK
ipt_stub -N LGTVBLK-FILTER
ipt_stub -A LGTVBLK-FILTER -p tcp --dport 853 -j DROP
ipt_stub -A LGTVBLK-FILTER -p udp --dport 853 -j DROP
ipt_stub -I OUTPUT 1 -j LGTVBLK-FILTER
LGTVB_STATE_DIR="$SB/state" TEST_LOG="$TEST_LOG" "$SB/bin/fake-dnscrypt-proxy" -config "$SB/state/dnscrypt-proxy.toml" >> "$SB/state/filter.log" 2>&1 </dev/null &
echo $! > "$SB/state/filter.pid"
sleep 0.3
run_app rollback.sh
assert_result "rollback: off/user-off" off user-off
n=0
while [ "$n" -lt 50 ] && ! grep -q 'filter-killed' "$TEST_LOG" 2>/dev/null; do sleep 0.1; n=$((n+1)); done
dell="$(log_line '-t nat -D OUTPUT -j LGTVBLK')"
killl="$(log_line 'filter-killed')"
if [ -n "$dell" ] && [ -n "$killl" ] && [ "$dell" -lt "$killl" ]; then ok "rollback: rules off before filter kill"; else no "rollback: rules off before filter kill" "del=$dell kill=$killl"; fi
if chk_log '-D OUTPUT -j LGTVBLK-FILTER'; then ok "rollback: filter-table jump deleted"; else no "rollback: filter-table jump deleted" "log: $(cat "$TEST_LOG")"; fi
if chk_log '-t nat -X LGTVBLK'; then ok "rollback: nat chain removed"; else no "rollback: nat chain removed" "log: $(cat "$TEST_LOG")"; fi
if chk_log '-X LGTVBLK-FILTER'; then ok "rollback: filter chain removed"; else no "rollback: filter chain removed" "log: $(cat "$TEST_LOG")"; fi
if chk_state '^pointer=off$'; then ok "rollback: pointer=off"; else no "rollback: pointer=off" "state: $(cat "$SB/state/state" 2>/dev/null)"; fi
if [ ! -e "$SB/state/filter.pid" ]; then ok "rollback: filter.pid removed"; else no "rollback: filter.pid removed" "pid file exists"; fi
cleanup_app_sandbox

# --- T3 Case 7: apply — lock held by a live pid -------------------------------
new_app_sandbox
printf 'upstream=192.168.179.1\ncap=dnat\npointer=on\n' > "$SB/state/state"
mkdir -p "$SB/state/lock"
sleep 60 &
holder=$!
echo "$holder" > "$SB/state/lock/pid"
t0="$(date +%s)"
run_app apply.sh
t1="$(date +%s)"
assert_result "apply lock busy: fail/locked" fail locked
# Bound: 10 lock iterations x sleep 1. Linux/CI lands at ~10-11s; MSYS process
# spawn overhead makes it ~14s, so allow 20s — the point is a bounded wait
# (lock_acquire returns after 10 tries), not a specific wall time.
if [ $((t1 - t0)) -le 20 ]; then ok "apply lock busy: bounded wait (<=20s)"; else no "apply lock busy: bounded wait (<=20s)" "took $((t1 - t0))s"; fi
if [ ! -s "$TEST_LOG" ]; then ok "apply lock busy: no rule changes"; else no "apply lock busy: no rule changes" "$(head -3 "$TEST_LOG")"; fi
if [ ! -e "$SB/state/filter.pid" ]; then ok "apply lock busy: filter not started"; else no "apply lock busy: filter not started" "pid file exists"; fi
kill -9 "$holder" 2>/dev/null
cleanup_app_sandbox

# ==================== S3 T4: keeper.sh sandbox ====================

# --- T4 Case 1: keeper — unresponsive filter → fail-open, restart, recovery ---
new_app_sandbox
blocked="$(grep -m1 '^=' "$SB/appdir/filter/filter-input.txt" | cut -c2-)"
printf '%s 2\n' "$blocked" > "$TEST_DNSQ_NAME_RC"
printf '127.0.0.1 1\n' > "$TEST_DNSQ_SERVER_RC"     # side-port canary fails: filter unresponsive
printf 'upstream=192.168.179.1\ncap=dnat\npointer=on\n' > "$SB/state/state"
seed_rules 192.168.179.1
start_fake_filter
run_bg keeper.sh; KEEPER_PID=$LAST_BG_PID
if wait_for "$SB/state/journal.log" 'keeper-filter-dead' 200; then ok "keeper recovery: filter declared dead"; else no "keeper recovery: filter declared dead" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
if wait_for "$TEST_LOG" 'filter-killed' 100; then ok "keeper recovery: dead filter killed after fail-open"; else no "keeper recovery: dead filter killed after fail-open" "$(tail -3 "$TEST_LOG" 2>/dev/null)"; fi
dell="$(log_line '-t nat -D OUTPUT -j LGTVBLK')"
killl="$(log_line 'filter-killed')"
if [ -n "$dell" ] && [ -n "$killl" ] && [ "$dell" -lt "$killl" ]; then ok "keeper recovery: rule deletes BEFORE filter kill"; else no "keeper recovery: rule deletes BEFORE filter kill" "del=$dell kill=$killl"; fi
printf '127.0.0.1 0\n' > "$TEST_DNSQ_SERVER_RC"     # dnsq "recovers"
if wait_for "$SB/state/journal.log" 'keeper-recovered' 200; then ok "keeper recovery: recovered after dnsq return"; else no "keeper recovery: recovered after dnsq return" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
rcount="$(grep -c 'keeper-restart n=' "$SB/state/journal.log" 2>/dev/null || true)"
if [ -n "$rcount" ] && [ "$rcount" -ge 1 ] && [ "$rcount" -le 3 ]; then ok "keeper recovery: bounded restarts (1..3)"; else no "keeper recovery: bounded restarts (1..3)" "count=$rcount"; fi
if chk_log '-t nat -I OUTPUT 1 -j LGTVBLK'; then ok "keeper recovery: rules re-added"; else no "keeper recovery: rules re-added" "$(tail -5 "$TEST_LOG" 2>/dev/null)"; fi
if chk_state '^pointer=on$'; then ok "keeper recovery: pointer stays on"; else no "keeper recovery: pointer stays on" "state: $(cat "$SB/state/state" 2>/dev/null)"; fi
if [ ! -e "$SB/state/gaveup" ]; then ok "keeper recovery: no gaveup"; else no "keeper recovery: no gaveup" "gaveup exists"; fi
stop_t4

# --- T4 Case 2: keeper — terminal give-up (dnsq never recovers) ----------------
new_app_sandbox
FILTER_STUB_BIN="$SB/bin/fake-dnscrypt-proxy-dead"
printf '127.0.0.1 1\n' > "$TEST_DNSQ_SERVER_RC"
printf 'upstream=192.168.179.1\ncap=dnat\npointer=on\n' > "$SB/state/state"
seed_rules 192.168.179.1
run_bg keeper.sh; KEEPER_PID=$LAST_BG_PID
if wait_for "$SB/state/journal.log" 'terminal-giveup reason=restarts-exhausted' 400; then ok "keeper give-up: terminal after exhausted restarts"; else no "keeper give-up: terminal after exhausted restarts" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
rcount="$(grep -c 'keeper-restart n=' "$SB/state/journal.log" 2>/dev/null || true)"
if [ "$rcount" = "3" ]; then ok "keeper give-up: exactly 3 restart attempts"; else no "keeper give-up: exactly 3 restart attempts" "count=$rcount"; fi
if [ -f "$SB/state/gaveup" ]; then ok "keeper give-up: gaveup marker"; else no "keeper give-up: gaveup marker" "no marker"; fi
if chk_state '^pointer=off$'; then ok "keeper give-up: pointer=off"; else no "keeper give-up: pointer=off" "state: $(cat "$SB/state/state" 2>/dev/null)"; fi
if chk_log '-t nat -D OUTPUT -j LGTVBLK'; then ok "keeper give-up: rules flushed"; else no "keeper give-up: rules flushed" "$(tail -3 "$TEST_LOG" 2>/dev/null)"; fi
sleep 3
rcount="$(grep -c 'keeper-restart n=' "$SB/state/journal.log" 2>/dev/null || true)"
if [ "$rcount" = "3" ]; then ok "keeper give-up: stays terminal (no new restarts)"; else no "keeper give-up: stays terminal (no new restarts)" "count=$rcount"; fi
stop_t4

# --- T4 Case 3: keeper — upstream change → full filter-side re-apply -----------
new_app_sandbox
blocked="$(grep -m1 '^=' "$SB/appdir/filter/filter-input.txt" | cut -c2-)"
printf '%s 2\n' "$blocked" > "$TEST_DNSQ_NAME_RC"
printf 'upstream=192.168.179.1\ncap=dnat\npointer=on\n' > "$SB/state/state"
seed_rules 192.168.179.1
start_fake_filter
printf '{"returnValue":true,"dns1":"192.168.5.5","dns2":"192.168.9.1"}\n' > "$SB/luna-new.json"
TEST_LUNA_FILE="$SB/luna-new.json"
: > "$TEST_IPT_STATE"    # foreign flush: rules vanish behind the keeper's back
run_bg keeper.sh; KEEPER_PID=$LAST_BG_PID
if wait_for "$SB/state/journal.log" 'keeper-upstream-changed' 200; then ok "keeper upstream change: detected"; else no "keeper upstream change: detected" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
if wait_for "$SB/state/journal.log" 'keeper-rules-readd ok' 100; then ok "keeper upstream change: re-applied + verified"; else no "keeper upstream change: re-applied + verified" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
if chk_state '^upstream=192.168.5.5$'; then ok "keeper upstream change: state upstream updated"; else no "keeper upstream change: state upstream updated" "state: $(cat "$SB/state/state" 2>/dev/null)"; fi
if grep -q "stamp = 'sdns://AAAAAAAAAAAADjE5Mi4xNjguNS41OjUz'" "$SB/state/dnscrypt-proxy.toml" 2>/dev/null; then ok "keeper upstream change: stamp regenerated for new upstream"; else no "keeper upstream change: stamp regenerated for new upstream" "$(tail -3 "$SB/state/dnscrypt-proxy.toml" 2>/dev/null)"; fi
if ! grep -q 'sdns://AAAAAAAAAAAAEDE5Mi4xNjguMTc5LjE6NTM' "$SB/state/dnscrypt-proxy.toml" 2>/dev/null; then ok "keeper upstream change: old stamp gone"; else no "keeper upstream change: old stamp gone" "stale stamp still in config"; fi
if chk_log '! -d 192.168.5.5 -p udp --dport 53 -j DNAT --to-destination 127.0.0.1:5335'; then ok "keeper upstream change: new exclusion in rules"; else no "keeper upstream change: new exclusion in rules" "$(tail -4 "$TEST_LOG" 2>/dev/null)"; fi
stop_t4

# --- T4 Case 4: guard — fires on dead keeper -----------------------------------
new_app_sandbox
printf 'upstream=192.168.179.1\ncap=dnat\npointer=on\n' > "$SB/state/state"
seed_rules 192.168.179.1
start_fake_filter
make_dead_pid
echo "$DEAD_PID" > "$SB/state/keeper.pid"
t0="$(date +%s)"
run_bg guard.sh; GUARD_PID=$LAST_BG_PID
if wait_for "$SB/state/journal.log" 'guard-fired keeper-dead' 100; then
  t1="$(date +%s)"
  if [ $((t1 - t0)) -le 6 ]; then ok "guard fire: fires within <=2 ticks"; else no "guard fire: fires within <=2 ticks" "took $((t1 - t0))s"; fi
else
  no "guard fire: fires within <=2 ticks" "never fired: $(cat "$SB/state/journal.log" 2>/dev/null)"
fi
if wait_for "$TEST_LOG" '-t nat -D OUTPUT -j LGTVBLK' 50; then ok "guard fire: rules off"; else no "guard fire: rules off" "$(tail -3 "$TEST_LOG" 2>/dev/null)"; fi
if wait_for "$TEST_LOG" 'filter-killed' 50; then ok "guard fire: filter killed"; else no "guard fire: filter killed" "no filter-killed"; fi
if wait_for "$SB/state/state" '^pointer=off$' 50; then ok "guard fire: pointer=off"; else no "guard fire: pointer=off" "state: $(cat "$SB/state/state" 2>/dev/null)"; fi
if wait_file "$SB/state/gaveup" 50; then ok "guard fire: gaveup marker (attention state)"; else no "guard fire: gaveup marker (attention state)" "no marker"; fi
exit_check "guard fire: exits after firing" "$GUARD_PID" 25
stop_t4

# --- T4 Case 5: guard — grace on missing keeper.pid ----------------------------
new_app_sandbox
run_bg guard.sh; GUARD_PID=$LAST_BG_PID
sleep 1.4
if jrnl 'guard-fired' || ! kill -0 "$GUARD_PID" 2>/dev/null; then no "guard grace: silent and alive before grace" "$(cat "$SB/state/journal.log" 2>/dev/null)"; else ok "guard grace: silent and alive before grace"; fi
if wait_for "$SB/state/journal.log" 'guard-fired keeper-never-started' 100; then ok "guard grace: fires after grace"; else no "guard grace: fires after grace" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
if wait_for "$SB/state/state" '^pointer=off$' 50; then ok "guard grace: pointer=off"; else no "guard grace: pointer=off" "state: $(cat "$SB/state/state" 2>/dev/null)"; fi
if wait_file "$SB/state/gaveup" 50; then ok "guard grace: gaveup marker (attention state)"; else no "guard grace: gaveup marker (attention state)" "no marker"; fi
exit_check "guard grace: exits after firing" "$GUARD_PID" 25
stop_t4

# --- T4 Case 6: keeper — restarts a dead guard ---------------------------------
new_app_sandbox
printf 'pointer=off\n' > "$SB/state/state"
make_dead_pid
echo "$DEAD_PID" > "$SB/state/guard.pid"
run_bg keeper.sh; KEEPER_PID=$LAST_BG_PID
if wait_for "$SB/state/journal.log" 'keeper-guard-restart' 100; then ok "keeper restarts dead guard: journal"; else no "keeper restarts dead guard: journal" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
gp=""
n=0
while [ "$n" -lt 50 ]; do
  gp=$(cat "$SB/state/guard.pid" 2>/dev/null || true)
  if [ -n "$gp" ] && [ "$gp" != "$DEAD_PID" ] && kill -0 "$gp" 2>/dev/null; then break; fi
  sleep 0.2; n=$((n+1))
done
if [ -n "$gp" ] && [ "$gp" != "$DEAD_PID" ] && kill -0 "$gp" 2>/dev/null; then ok "keeper restarts dead guard: new live guard"; else no "keeper restarts dead guard: new live guard" "guard.pid=$gp"; fi
stop_t4

# ==================== S3 T5: boot.sh reconciler + check.sh schema 2 ====================

run_check_nostub() {  # check.sh without the stub bin on PATH (no iptables → degraded)
  OUT="$(env PATH="/usr/bin:/bin" LGTVB_STATE_DIR="$SB/state" LGTVB_HOOK_DIR="$SB/hookdir" \
    "$SH" "$SB/appdir/scripts/check.sh" 2>"$SB/stderr")"
  RC=$?
}

# --- T5 Case 1: check.sh — no state, no hook → honest degraded block ----------
new_app_sandbox
run_check_nostub
assert_block "check schema2: no state → missing/degraded" "@@STATUS-BEGIN
schema=2
ts=<TS>
hook=missing
hook_target=none
scripts=ok
filter=down
rule=absent
keeper=down
guard=down
pointer=off
gaveup=no
mode=degraded
upstream=none
cap=unsupported
@@STATUS-END"

# --- T5 Case 2: check.sh — full live ON state (one pair / 14 keys / LF) -------
new_app_sandbox
printf 'upstream=192.168.179.1\ncap=dnat\npointer=on\n' > "$SB/state/state"
blocked="$(grep -m1 '^=' "$SB/appdir/filter/filter-input.txt" | cut -c2-)"
printf '%s 2\n' "$blocked" > "$TEST_DNSQ_NAME_RC"
seed_rules 192.168.179.1
start_fake_filter
run_bg keeper.sh; KEEPER_PID=$LAST_BG_PID
n=0
gp=""
while [ "$n" -lt 100 ]; do
  gp=$(cat "$SB/state/guard.pid" 2>/dev/null || true)
  if [ -n "$gp" ] && kill -0 "$gp" 2>/dev/null; then break; fi
  sleep 0.2; n=$((n+1))
done
run_app check.sh
assert_block "check schema2: full ON (live filter/keeper/guard)" "@@STATUS-BEGIN
schema=2
ts=<TS>
hook=missing
hook_target=none
scripts=ok
filter=up
rule=on
keeper=up
guard=up
pointer=on
gaveup=no
mode=on
upstream=192.168.179.1
cap=dnat
@@STATUS-END"
begincount="$(printf '%s\n' "$OUT" | grep -c '^@@STATUS-BEGIN$')"
endcount="$(printf '%s\n' "$OUT" | grep -c '^@@STATUS-END$')"
keycount="$(printf '%s\n' "$OUT" | grep -c '^[a-z_]*=')"
if [ "$begincount" = "1" ] && [ "$endcount" = "1" ] && [ "$keycount" = "14" ]; then
  ok "check schema2: exactly one block, 14 keys"
else
  no "check schema2: exactly one block, 14 keys" "begin=$begincount end=$endcount keys=$keycount"
fi
crbytes="$(printf '%s' "$OUT" | tr -d '\r' | wc -c | tr -d ' ')"
rawbytes="$(printf '%s' "$OUT" | wc -c | tr -d ' ')"
if [ "$crbytes" = "$rawbytes" ]; then ok "check schema2: LF only (no CR)"; else no "check schema2: LF only (no CR)" "cr=$crbytes raw=$rawbytes"; fi
stop_t4

# --- T5 Case 3: check.sh — hostile hook targets (relative / newline) ----------
new_app_sandbox
ln -s "relative/path" "$SB/hookdir/50-lgtv-blocklist-app"
run_check_nostub
assert_block "check schema2: relative target → other/none" "@@STATUS-BEGIN
schema=2
ts=<TS>
hook=other
hook_target=none
scripts=ok
filter=down
rule=absent
keeper=down
guard=down
pointer=off
gaveup=no
mode=degraded
upstream=none
cap=unsupported
@@STATUS-END"

new_app_sandbox
ln -s "$(printf 'evil\n@@STATUS-END\nhook=linked')" "$SB/hookdir/50-lgtv-blocklist-app"
run_check_nostub
assert_block "check schema2: newline target sanitized" "@@STATUS-BEGIN
schema=2
ts=<TS>
hook=other
hook_target=none
scripts=ok
filter=down
rule=absent
keeper=down
guard=down
pointer=off
gaveup=no
mode=degraded
upstream=none
cap=unsupported
@@STATUS-END"
linecount="$(printf '%s\n' "$OUT" | wc -l | tr -d ' ')"
if [ "$linecount" = "16" ]; then ok "check schema2: hostile target keeps block at 16 lines"; else no "check schema2: hostile target keeps block at 16 lines" "got $linecount"; fi

# --- T5 Case 4: check.sh — gaveup marker + stored upstream (cap present) ------
new_app_sandbox
printf 'upstream=192.168.179.1\ncap=dnat\npointer=off\n' > "$SB/state/state"
: > "$SB/state/gaveup"
run_app check.sh
assert_block "check schema2: gaveup=yes, pointer=off, cap=dnat" "@@STATUS-BEGIN
schema=2
ts=<TS>
hook=missing
hook_target=none
scripts=ok
filter=down
rule=off
keeper=down
guard=down
pointer=off
gaveup=yes
mode=off
upstream=192.168.179.1
cap=dnat
@@STATUS-END"

# --- T5 Case 5: boot.sh — fast, non-blocking reconciler (stale state, re-arm) --
new_app_sandbox
printf 'upstream=192.168.179.1\ncap=dnat\npointer=on\n' > "$SB/state/state"
blocked="$(grep -m1 '^=' "$SB/appdir/filter/filter-input.txt" | cut -c2-)"
printf '%s 2\n' "$blocked" > "$TEST_DNSQ_NAME_RC"
seed_rules 192.168.179.1
make_dead_pid; KDEAD=$DEAD_PID; echo "$KDEAD" > "$SB/state/keeper.pid"
make_dead_pid; GDEAD=$DEAD_PID; echo "$GDEAD" > "$SB/state/guard.pid"
make_dead_pid; echo "$DEAD_PID" > "$SB/state/filter.pid"
mkdir -p "$SB/state/lock"; echo "$GDEAD" > "$SB/state/lock/pid"
KEEPER_PID=""; GUARD_PID=""
t0="$(date +%s)"
env PATH="$SB/bin:$BASE_PATH" LGTVB_STATE_DIR="$SB/state" LGTVB_HOOK_DIR="$SB/hookdir" \
  LGTVB_DNSQ="$SB/bin/dnsq" LGTVB_FILTER_BIN="$SB/bin/fake-dnscrypt-proxy" \
  LGTVB_TICK=1 LGTVB_GUARD_TICK=1 LGTVB_BACKOFF=1 LGTVB_UWAIT_ROUNDS=1 LGTVB_UWAIT_SLEEP=1 \
  LGTVB_GUARD_GRACE=2 LGTVB_TARGETS_FILE="$SB/targets" \
  TEST_LOG="$TEST_LOG" TEST_IPT_STATE="$TEST_IPT_STATE" \
  TEST_DNSQ_NAME_RC="$TEST_DNSQ_NAME_RC" TEST_DNSQ_SERVER_RC="$TEST_DNSQ_SERVER_RC" \
  TEST_DNSQ_RC=0 \
  "$SH" "$SB/appdir/scripts/boot.sh" >>"$SB/boot.out" 2>&1 </dev/null &
BPID=$!
n=0
while [ "$n" -lt 50 ] && kill -0 "$BPID" 2>/dev/null; do sleep 0.2; n=$((n+1)); done
t1="$(date +%s)"
if kill -0 "$BPID" 2>/dev/null; then
  kill -9 "$BPID" 2>/dev/null
  no "boot: returns fast (no synchronous wait)" "still running after 10s"
else
  ok "boot: returns fast (no synchronous wait)"
fi
# Second-granularity on purpose: the hard bound is the 10s poll above; this
# asserts the common case (boot.sh only forks and exits).
if [ $((t1 - t0)) -le 2 ]; then ok "boot: wall time <= 2s"; else no "boot: wall time <= 2s" "took $((t1 - t0))s"; fi
if jrnl 'boot-start pid='; then ok "boot: journal boot-start"; else no "boot: journal boot-start" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
if jrnl 'boot pointer=on' && jrnl 'boot-supervisors-started'; then ok "boot: journal pointer + supervisors"; else no "boot: journal pointer + supervisors" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
n=0
kp=""
while [ "$n" -lt 100 ]; do
  kp=$(cat "$SB/state/keeper.pid" 2>/dev/null || true)
  if [ -n "$kp" ] && [ "$kp" != "$KDEAD" ] && kill -0 "$kp" 2>/dev/null; then break; fi
  sleep 0.2; n=$((n+1))
done
if [ -n "$kp" ] && [ "$kp" != "$KDEAD" ] && kill -0 "$kp" 2>/dev/null; then ok "boot: stale keeper.pid cleared, keeper live"; else no "boot: stale keeper.pid cleared, keeper live" "keeper.pid=$kp"; fi
n=0
gp=""
while [ "$n" -lt 100 ]; do
  gp=$(cat "$SB/state/guard.pid" 2>/dev/null || true)
  if [ -n "$gp" ] && [ "$gp" != "$GDEAD" ] && kill -0 "$gp" 2>/dev/null; then break; fi
  sleep 0.2; n=$((n+1))
done
if [ -n "$gp" ] && [ "$gp" != "$GDEAD" ] && kill -0 "$gp" 2>/dev/null; then ok "boot: guard live as well"; else no "boot: guard live as well" "guard.pid=$gp"; fi
if chk_state '^pointer=on$' && chk_state '^upstream=192.168.179.1$'; then ok "boot: state intact (pointer+upstream)"; else no "boot: state intact (pointer+upstream)" "state: $(cat "$SB/state/state" 2>/dev/null)"; fi
if [ ! -d "$SB/state/lock" ]; then ok "boot: stale lock cleared"; else no "boot: stale lock cleared" "lock dir exists"; fi
if wait_for "$SB/state/journal.log" 'keeper-recovered' 100; then ok "boot: pointer=on → keeper re-arms (recovered)"; else no "boot: pointer=on → keeper re-arms (recovered)" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
stop_t4

# ==================== S3 review-fix coverage ====================
# Fix 1: runtime upstream stamp (template token + materialize substitution).
# Fix 2: keeper stale-lock recovery, live-lock skip, apply signal trap.
# Fix 4: checked materialize (upstream-change + restart paths).
# Fix 7: fixed-key state_get / literal cmdline_has.

probe_run() {  # probe_run <helper> [args...] — call a common.sh helper via probe.sh
  env PATH="$SB/bin:$BASE_PATH" LGTVB_STATE_DIR="$SB/state" LGTVB_HOOK_DIR="$SB/hookdir" \
    LGTVB_DNSQ="$SB/bin/dnsq" LGTVB_FILTER_BIN="$SB/bin/fake-dnscrypt-proxy" \
    LGTVB_TARGETS_FILE="$SB/targets" \
    TEST_LOG="$TEST_LOG" TEST_IPT_STATE="$TEST_IPT_STATE" \
    "$SH" "$SB/appdir/scripts/probe.sh" "$@"
}

# --- Fix 1: stamp encoder (vectors computed independently with node Buffer) ---
new_app_sandbox
stamp_check() {  # stamp_check <name> <ip> <expected stamp>
  OUT="$(probe_run stamp "$2")"
  got="$(printf '%s\n' "$OUT" | sed -n '1p')"
  rc="$(printf '%s\n' "$OUT" | sed -n '2p')"
  if [ "$got" = "$3" ] && [ "$rc" = "rc=0" ]; then ok "$1"; else no "$1" "got [$got] [$rc]"; fi
}
stamp_check "stamp: 192.168.179.1 (S0 vector)" 192.168.179.1 'sdns://AAAAAAAAAAAAEDE5Mi4xNjguMTc5LjE6NTM'
stamp_check "stamp: 192.168.5.5" 192.168.5.5 'sdns://AAAAAAAAAAAADjE5Mi4xNjguNS41OjUz'
stamp_check "stamp: 10.0.0.1 (exact 3-byte groups)" 10.0.0.1 'sdns://AAAAAAAAAAAACzEwLjAuMC4xOjUz'
stamp_check "stamp: 255.255.255.255" 255.255.255.255 'sdns://AAAAAAAAAAAAEjI1NS4yNTUuMjU1LjI1NTo1Mw'
OUT="$(probe_run stamp 'not.an.ip')"
if [ "$(printf '%s\n' "$OUT" | sed -n '2p')" = "rc=1" ]; then ok "stamp: invalid upstream rejected"; else no "stamp: invalid upstream rejected" "got [$OUT]"; fi
if ! grep -q '192\.168\.179\.' "$FILTER_SRC/dnscrypt-proxy.toml.template" "$FILTER_SRC/forward-rules.txt.template"; then ok "stamp: shipped templates carry no hardcoded IP"; else no "stamp: shipped templates carry no hardcoded IP" "$(grep -Hn '192\.168\.179\.' "$FILTER_SRC/dnscrypt-proxy.toml.template" "$FILTER_SRC/forward-rules.txt.template")"; fi
cleanup_app_sandbox

# --- Fix 1: materialize — explicit no-upstream failure + stamp from upstream ---
new_app_sandbox
OUT="$(probe_run materialize '')"
if [ "$(printf '%s\n' "$OUT" | sed -n '1p')" = "rc=1" ] && [ ! -f "$SB/state/dnscrypt-proxy.toml" ]; then ok "materialize: empty upstream → rc 1, nothing written"; else no "materialize: empty upstream → rc 1, nothing written" "got [$OUT]"; fi
if jrnl 'materialize-fail reason=no-upstream'; then ok "materialize: clear journal reason"; else no "materialize: clear journal reason" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
OUT="$(probe_run materialize 192.168.5.5)"
if [ "$(printf '%s\n' "$OUT" | sed -n '1p')" = "rc=0" ] && grep -q "stamp = 'sdns://AAAAAAAAAAAADjE5Mi4xNjguNS41OjUz'" "$SB/state/dnscrypt-proxy.toml" 2>/dev/null; then ok "materialize: config stamp matches learned upstream"; else no "materialize: config stamp matches learned upstream" "got [$OUT] $(tail -3 "$SB/state/dnscrypt-proxy.toml" 2>/dev/null)"; fi
if ! grep -q '192\.168\.179\.' "$SB/state/dnscrypt-proxy.toml" 2>/dev/null && ! grep -q '@STAMP@' "$SB/state/dnscrypt-proxy.toml" 2>/dev/null; then ok "materialize: no hardcoded IP, no leftover token"; else no "materialize: no hardcoded IP, no leftover token" "$(grep -n '192\.168\.179\.\|@STAMP@' "$SB/state/dnscrypt-proxy.toml" 2>/dev/null)"; fi
cleanup_app_sandbox

# --- Fix 2: keeper — stale lock (dead pid) cleared, keeper proceeds -----------
new_app_sandbox
blocked="$(grep -m1 '^=' "$SB/appdir/filter/filter-input.txt" | cut -c2-)"
printf '%s 2\n' "$blocked" > "$TEST_DNSQ_NAME_RC"
printf 'upstream=192.168.179.1\ncap=dnat\npointer=on\n' > "$SB/state/state"
cp "$SB/appdir/filter/filter-input.txt" "$SB/state/filter-input.txt"   # canary_blocked reads the state copy
start_fake_filter
# rules NOT seeded → a proceeding keeper must re-add them (visible journal line)
make_dead_pid
mkdir -p "$SB/state/lock"; echo "$DEAD_PID" > "$SB/state/lock/pid"
run_bg keeper.sh; KEEPER_PID=$LAST_BG_PID
if wait_for "$SB/state/journal.log" 'keeper-rules-readd ok' 200; then ok "keeper stale lock: proceeds (rules re-added)"; else no "keeper stale lock: proceeds (rules re-added)" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
if [ ! -d "$SB/state/lock" ]; then ok "keeper stale lock: cleared"; else no "keeper stale lock: cleared" "lock dir still present"; fi
stop_t4

# --- Fix 2: keeper — live lock still makes it skip ----------------------------
new_app_sandbox
printf 'upstream=192.168.179.1\ncap=dnat\npointer=on\n' > "$SB/state/state"
start_fake_filter
sleep 60 &
holder=$!
mkdir -p "$SB/state/lock"; echo "$holder" > "$SB/state/lock/pid"
run_bg keeper.sh; KEEPER_PID=$LAST_BG_PID
sleep 2.5
if [ -d "$SB/state/lock" ]; then ok "keeper live lock: kept"; else no "keeper live lock: kept" "lock dir removed"; fi
if ! chk_log 'LGTVBLK'; then ok "keeper live lock: skipped (no rule changes)"; else no "keeper live lock: skipped (no rule changes)" "$(grep LGTVBLK "$TEST_LOG" 2>/dev/null | head -2)"; fi
kill -9 "$holder" 2>/dev/null
stop_t4

# --- Fix 2: apply — signal releases the lock ----------------------------------
new_app_sandbox
printf '127.0.0.1 1\n' > "$TEST_DNSQ_SERVER_RC"    # side-port canary fails → slow path
run_bg apply.sh; APID=$LAST_BG_PID
n=0
while [ "$n" -lt 100 ] && [ ! -f "$SB/state/dnscrypt-proxy.toml" ]; do sleep 0.1; n=$((n+1)); done
if [ -f "$SB/state/dnscrypt-proxy.toml" ] && [ -d "$SB/state/lock" ]; then
  kill -TERM "$APID" 2>/dev/null
  n=0
  while [ "$n" -lt 100 ] && [ -d "$SB/state/lock" ]; do sleep 0.2; n=$((n+1)); done
  if [ ! -d "$SB/state/lock" ]; then ok "apply TERM: lock released"; else no "apply TERM: lock released" "lock dir still present"; fi
else
  no "apply TERM: lock released" "apply never reached materialize"
fi
exit_check "apply TERM: process exits" "$APID" 50
cleanup_app_sandbox

# --- Fix 4: keeper — failed materialize on upstream change fails open ---------
new_app_sandbox
printf 'upstream=192.168.179.1\ncap=dnat\npointer=on\n' > "$SB/state/state"
seed_rules 192.168.179.1
start_fake_filter
printf '{"returnValue":true,"dns1":"192.168.5.5","dns2":"192.168.9.1"}\n' > "$SB/luna-new.json"
TEST_LUNA_FILE="$SB/luna-new.json"
: > "$TEST_IPT_STATE"                       # foreign flush → upstream-change path
rm "$SB/appdir/filter/dnscrypt-proxy.toml.template"
run_bg keeper.sh; KEEPER_PID=$LAST_BG_PID
if wait_for "$SB/state/journal.log" 'terminal-giveup reason=upstream-change-materialize' 200; then ok "keeper materialize fail (change): fails open"; else no "keeper materialize fail (change): fails open" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
if [ -f "$SB/state/gaveup" ]; then ok "keeper materialize fail (change): gaveup marker"; else no "keeper materialize fail (change): gaveup marker" "no marker"; fi
if chk_state '^pointer=off$'; then ok "keeper materialize fail (change): pointer=off"; else no "keeper materialize fail (change): pointer=off" "state: $(cat "$SB/state/state" 2>/dev/null)"; fi
if ! jrnl 'keeper-restart'; then ok "keeper materialize fail (change): filter never restarted"; else no "keeper materialize fail (change): filter never restarted" "$(grep 'keeper-restart' "$SB/state/journal.log")"; fi
stop_t4

# --- Fix 4: keeper — failed materialize on the restart path fails open --------
new_app_sandbox
FILTER_STUB_BIN="$SB/bin/fake-dnscrypt-proxy-dead"
printf 'upstream=192.168.179.1\ncap=dnat\npointer=on\n' > "$SB/state/state"
seed_rules 192.168.179.1
rm "$SB/appdir/filter/dnscrypt-proxy.toml.template"
run_bg keeper.sh; KEEPER_PID=$LAST_BG_PID
if wait_for "$SB/state/journal.log" 'terminal-giveup reason=materialize' 400; then ok "keeper materialize fail (restart): fails open"; else no "keeper materialize fail (restart): fails open" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
if [ -f "$SB/state/gaveup" ]; then ok "keeper materialize fail (restart): gaveup marker"; else no "keeper materialize fail (restart): gaveup marker" "no marker"; fi
if chk_state '^pointer=off$'; then ok "keeper materialize fail (restart): pointer=off"; else no "keeper materialize fail (restart): pointer=off" "state: $(cat "$SB/state/state" 2>/dev/null)"; fi
if ! jrnl 'keeper-restart'; then ok "keeper materialize fail (restart): filter never restarted"; else no "keeper materialize fail (restart): filter never restarted" "$(grep 'keeper-restart' "$SB/state/journal.log")"; fi
stop_t4

# --- Fix 7: fixed-key state_get / literal cmdline_has -------------------------
new_app_sandbox
printf 'upXstream=WRONG\nup.stream=RIGHT\n' > "$SB/state/state"
OUT="$(probe_run state_get 'up.stream')"
if [ "$(printf '%s\n' "$OUT" | sed -n '1p')" = "RIGHT" ]; then ok "state_get: metachar key matched literally"; else no "state_get: metachar key matched literally" "got [$OUT]"; fi
OUT="$(probe_run state_get absent)"
if [ "$(printf '%s\n' "$OUT" | sed -n '1p')" = "rc=1" ]; then ok "state_get: missing key → rc 1"; else no "state_get: missing key → rc 1" "got [$OUT]"; fi
sleep 30.5 &
dpid=$!
sleep 0.3
OUT="$(probe_run cmdline_has "$dpid" 'sleep 3.5')"
if [ "$(printf '%s\n' "$OUT" | sed -n '1p')" = "rc=1" ]; then ok "cmdline_has: metachar pattern matched literally"; else no "cmdline_has: metachar pattern matched literally" "got [$OUT]"; fi
OUT="$(probe_run cmdline_has "$dpid" 'sleep 30.5')"
if [ "$(printf '%s\n' "$OUT" | sed -n '1p')" = "rc=0" ]; then ok "cmdline_has: exact substring matches"; else no "cmdline_has: exact substring matches" "got [$OUT]"; fi
kill -9 "$dpid" 2>/dev/null
cleanup_app_sandbox

# --- Summary -----------------------------------------------------------------
printf '\n%s passed, %s failed\n' "$pass" "$fail"
if [ "$fail" -ne 0 ]; then
  exit 1
fi
exit 0
