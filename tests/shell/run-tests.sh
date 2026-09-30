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
  # S4/T3: default "filter listening" fixture for the keeper's cheap probe
  # (port 5335 = 0x14D7, local 127.0.0.1, state 0A = LISTEN). Tests that need
  # "device without the port" overwrite this file after new_app_sandbox.
  printf '  sl  local_address rem_address   st\n   0: 0100007F:14D7 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 0 1 0000000000000000 100\n' > "$SB/proc_tcp"
  # probe.sh — sources common.sh with the same $0-based paths as the app scripts,
  # so the suite can call helpers directly (state_set, state_get, cmdline_has,
  # materialize) instead of only through the fixed entrypoints.
  printf '%s\n' \
    'SELF=$(readlink -f "$0" 2>/dev/null); [ -n "$SELF" ] || SELF="$0"' \
    'SELF_DIR=${SELF%/*}' \
    '. "$SELF_DIR/common.sh"' \
    'case ${1:-} in' \
    '  state_get) shift; state_get "$1"; echo "rc=$?" ;;' \
    '  state_set) shift; state_set "$1" "$2"; echo "rc=$?" ;;' \
    '  cmdline_has) shift; cmdline_has "$1" "$2"; echo "rc=$?" ;;' \
    '  ensure) shift; ensure_state; echo "rc=$?" ;;' \
    '  materialize) shift; materialize_config "$1"; echo "rc=$?" ;;' \
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
  TEST_IPT_LOCK_ONCE=""; TEST_DNSQ_IPT_GATE=""
}

run_app() {  # run_app <script-name>; sets OUT + RC (env-only, no args to scripts)
  OUT="$(env PATH="$SB/bin:$BASE_PATH" \
    LGTVB_STATE_DIR="$SB/state" LGTVB_HOOK_DIR="$SB/hookdir" \
    LGTVB_DNSQ="$SB/bin/dnsq" LGTVB_FILTER_BIN="$SB/bin/fake-dnscrypt-proxy" \
    LGTVB_TICK=1 LGTVB_GUARD_TICK=1 LGTVB_TARGETS_FILE="$SB/targets" \
    LGTVB_RULES_RETRY=3 LGTVB_RULES_RETRY_SLEEP=0 \
    LGTVB_PROC_TCP="$SB/proc_tcp" LGTVB_CANARY_EVERY=1 \
    TEST_LOG="$TEST_LOG" TEST_IPT_STATE="$TEST_IPT_STATE" \
    TEST_DNSQ_NAME_RC="$TEST_DNSQ_NAME_RC" TEST_DNSQ_SERVER_RC="$TEST_DNSQ_SERVER_RC" \
    TEST_DNSQ_RC="$DNSQ_RC" TEST_LUNA_FILE="${TEST_LUNA_FILE:-}" \
    TEST_IPT_LOCK_ONCE="${TEST_IPT_LOCK_ONCE:-}" TEST_DNSQ_IPT_GATE="${TEST_DNSQ_IPT_GATE:-}" \
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
  # TICK_OVERRIDE: tests that assert real production budget use TICK_OVERRIDE=5.
  env PATH="$SB/bin:$BASE_PATH" \
    LGTVB_STATE_DIR="$SB/state" LGTVB_HOOK_DIR="$SB/hookdir" \
    LGTVB_DNSQ="$SB/bin/dnsq" LGTVB_FILTER_BIN="${FILTER_STUB_BIN:-$SB/bin/fake-dnscrypt-proxy}" \
    LGTVB_TICK="${TICK_OVERRIDE:-1}" LGTVB_GUARD_TICK="${TICK_OVERRIDE:-1}" \
    LGTVB_BACKOFF=1 LGTVB_UWAIT_ROUNDS=2 LGTVB_UWAIT_SLEEP=1 LGTVB_GUARD_GRACE=2 \
    LGTVB_RULES_RETRY=3 LGTVB_RULES_RETRY_SLEEP=0 \
    LGTVB_TARGETS_FILE="$SB/targets" \
    LGTVB_PROC_TCP="$SB/proc_tcp" LGTVB_CANARY_EVERY=1 \
    TEST_LOG="$TEST_LOG" TEST_IPT_STATE="$TEST_IPT_STATE" \
    TEST_DNSQ_NAME_RC="$TEST_DNSQ_NAME_RC" TEST_DNSQ_SERVER_RC="$TEST_DNSQ_SERVER_RC" \
    TEST_DNSQ_RC="$DNSQ_RC" TEST_LUNA_FILE="${TEST_LUNA_FILE:-}" \
    TEST_IPT_LOCK_ONCE="${TEST_IPT_LOCK_ONCE:-}" TEST_DNSQ_IPT_GATE="${TEST_DNSQ_IPT_GATE:-}" \
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
if grep -q '^\. 192\.168\.179\.1$' "$SB/state/forward-rules.txt" 2>/dev/null; then ok "apply happy path: forward-rules rewritten to learned upstream"; else no "apply happy path: forward-rules rewritten to learned upstream" "$(cat "$SB/state/forward-rules.txt" 2>/dev/null)"; fi
if ! grep -qF '@' "$SB/state/dnscrypt-proxy.toml" 2>/dev/null && ! grep -q 'sdns://' "$SB/state/dnscrypt-proxy.toml" 2>/dev/null && ! grep -qF '[static]' "$SB/state/dnscrypt-proxy.toml" 2>/dev/null; then ok "apply happy path: rendered config token-free (no @, sdns://, [static])"; else no "apply happy path: rendered config token-free (no @, sdns://, [static])" "$(grep -nF '@' "$SB/state/dnscrypt-proxy.toml" 2>/dev/null; grep -n 'sdns://\|\[static\]' "$SB/state/dnscrypt-proxy.toml" 2>/dev/null)"; fi
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
if grep -q '^\. 192\.168\.5\.5$' "$SB/state/forward-rules.txt" 2>/dev/null; then ok "keeper upstream change: forward-rules rewritten to new upstream"; else no "keeper upstream change: forward-rules rewritten to new upstream" "$(cat "$SB/state/forward-rules.txt" 2>/dev/null)"; fi
if ! grep -q '^\. 192\.168\.179\.1$' "$SB/state/forward-rules.txt" 2>/dev/null; then ok "keeper upstream change: old upstream gone from forward-rules"; else no "keeper upstream change: old upstream gone from forward-rules" "$(cat "$SB/state/forward-rules.txt" 2>/dev/null)"; fi
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

# ==================== S4 T3: keeper cheap liveness + duplicate guards ====================

# --- S4-T3 Case 1: cheap-death — filter pid ALIVE, listening port gone ---------
# The dnsq canary would PASS here (stub rc 0), so a declaration of death proves the
# cheap pid+port probe (not the canary) drove the single-sample dead path.
new_app_sandbox
blocked="$(grep -m1 '^=' "$SB/appdir/filter/filter-input.txt" | cut -c2-)"
printf '%s 2\n' "$blocked" > "$TEST_DNSQ_NAME_RC"
printf 'upstream=192.168.179.1\ncap=dnat\npointer=on\n' > "$SB/state/state"
seed_rules 192.168.179.1
start_fake_filter
printf '  sl  local_address rem_address   st\n' > "$SB/proc_tcp"     # port fixture: NOT listening
run_bg keeper.sh; KEEPER_PID=$LAST_BG_PID
if wait_for "$SB/state/journal.log" 'keeper-filter-dead restore-first' 100; then ok "keeper cheap-death: declared dead on closed port (alive pid)"; else no "keeper cheap-death: declared dead on closed port (alive pid)" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
# filter-killed is written by the fake filter's watcher (~0.1 s poll) — wait for it
# before comparing log positions (same pattern as T4 Case 1).
n=0
while [ "$n" -lt 100 ] && ! grep -q 'filter-killed' "$TEST_LOG" 2>/dev/null; do sleep 0.1; n=$((n+1)); done
dell="$(log_line '-t nat -D OUTPUT -j LGTVBLK')"
killl="$(log_line 'filter-killed')"
if [ -n "$dell" ] && [ -n "$killl" ] && [ "$dell" -lt "$killl" ]; then ok "keeper cheap-death: rule deletes BEFORE filter kill"; else no "keeper cheap-death: rule deletes BEFORE filter kill" "del=$dell kill=$killl"; fi
if wait_for "$SB/state/journal.log" 'keeper-recovered' 200; then ok "keeper cheap-death: re-armed + recovered"; else no "keeper cheap-death: re-armed + recovered" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
stop_t4

# --- S4-T3 Case 2: functional death still needs 2 consecutive canary misses -----
# Port fixture present (cheap probe passes); side-port canary fails. One miss must
# not be terminal; the second consecutive miss must be. Timing: each canary miss
# costs 3 attempts x (dnsq spawn + sleep 1) ≈ 4 s, so death cannot occur before
# ~8 s — the 3 s early check is a safe window, the final wait_for is the proof.
new_app_sandbox
printf 'upstream=192.168.179.1\ncap=dnat\npointer=on\n' > "$SB/state/state"
seed_rules 192.168.179.1
start_fake_filter
printf '127.0.0.1 1\n' > "$TEST_DNSQ_SERVER_RC"     # side-port canary fails: not listening to queries
run_bg keeper.sh; KEEPER_PID=$LAST_BG_PID
sleep 3
if ! jrnl 'keeper-filter-dead'; then ok "keeper 2-miss gate: single canary miss not terminal"; else no "keeper 2-miss gate: single canary miss not terminal" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
if wait_for "$SB/state/journal.log" 'keeper-filter-dead restore-first' 200; then ok "keeper 2-miss gate: second consecutive miss declares death"; else no "keeper 2-miss gate: second consecutive miss declares death" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
stop_t4

# --- S4-T3 Case 3: keeper duplicate-exit keeps the ORIGINAL pid -----------------
# Fake live keeper: `sleep` must NOT be the entire -c script (the shell would
# tail-exec it and the "keeper" substring would vanish from /proc/<pid>/cmdline,
# defeating pid_alive's PID-reuse guard); `; :` keeps the shell alive instead.
new_app_sandbox
sh -c 'sleep 60; :' keeper-fake-$SB &
FPID=$!
echo "$FPID" >> "$SB/state/fake-pids"
echo "$FPID" > "$SB/state/keeper.pid"
run_bg keeper.sh
if wait_for "$SB/state/journal.log" 'keeper-duplicate-exit' 100; then ok "keeper duplicate: second instance exits"; else no "keeper duplicate: second instance exits" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
if [ "$(cat "$SB/state/keeper.pid" 2>/dev/null)" = "$FPID" ]; then ok "keeper duplicate: original pid preserved"; else no "keeper duplicate: original pid preserved" "keeper.pid=$(cat "$SB/state/keeper.pid" 2>/dev/null) want=$FPID"; fi
stop_t4

# --- S4-T3 Case 4: guard duplicate-exit keeps the ORIGINAL pid ------------------
new_app_sandbox
sh -c 'sleep 60; :' guard-fake-$SB &
FPID=$!
echo "$FPID" >> "$SB/state/fake-pids"
echo "$FPID" > "$SB/state/guard.pid"
run_bg guard.sh
if wait_for "$SB/state/journal.log" 'guard-duplicate-exit' 100; then ok "guard duplicate: second instance exits"; else no "guard duplicate: second instance exits" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
if [ "$(cat "$SB/state/guard.pid" 2>/dev/null)" = "$FPID" ]; then ok "guard duplicate: original pid preserved"; else no "guard duplicate: original pid preserved" "guard.pid=$(cat "$SB/state/guard.pid" 2>/dev/null) want=$FPID"; fi
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

# ==================== S4 T2: boot pointer-vs-live reconciliation ====================
# Journal lines (boot-reconcile …) are asserted with jrnl (journal.log), not chk_log
# (TEST_LOG = iptables stub log): the plan's chk_log naming does not match the sink.

# --- S4-T2 Case 1: pointer=off + stray chains → guarded cleanup ----------------
new_app_sandbox
printf 'upstream=192.168.179.1\ncap=dnat\npointer=off\n' > "$SB/state/state"
seed_rules 192.168.179.1
run_app boot.sh
if jrnl 'boot-reconcile pointer=off stray-rules-found'; then ok "boot-off-stray: stray chains detected"; else no "boot-off-stray: stray chains detected" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
if jrnl 'boot-reconcile pointer=off live-cleaned'; then ok "boot-off-stray: stray chains cleaned"; else no "boot-off-stray: stray chains cleaned" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
if ! grep -q 'LGTVBLK' "$TEST_IPT_STATE"; then ok "boot-off-stray: both chains removed from ruleset"; else no "boot-off-stray: both chains removed from ruleset" "$(grep 'LGTVBLK' "$TEST_IPT_STATE")"; fi
stop_t4

# --- S4-T2 Case 2: pointer=off, no stray chains → zero rule-churn --------------
new_app_sandbox
printf 'upstream=192.168.179.1\ncap=dnat\npointer=off\n' > "$SB/state/state"
run_app boot.sh
if ! jrnl 'stray-rules-found'; then ok "boot-off-clean: no stray-reconcile log"; else no "boot-off-clean: no stray-reconcile log" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
if [ ! -s "$TEST_IPT_STATE" ]; then ok "boot-off-clean: ruleset untouched (empty)"; else no "boot-off-clean: ruleset untouched (empty)" "$(cat "$TEST_IPT_STATE")"; fi
if ! grep -qE ' -D |-F |-X ' "$TEST_LOG" 2>/dev/null; then ok "boot-off-clean: no chain-remove calls recorded"; else no "boot-off-clean: no chain-remove calls recorded" "$(grep -E ' -D |-F |-X ' "$TEST_LOG" | head -3)"; fi
stop_t4

# --- S4-T2 Case 3: pointer=on → delegated to keeper, supervisors live -----------
new_app_sandbox
blocked="$(grep -m1 '^=' "$SB/appdir/filter/filter-input.txt" | cut -c2-)"
printf '%s 2\n' "$blocked" > "$TEST_DNSQ_NAME_RC"
printf 'upstream=192.168.179.1\ncap=dnat\npointer=on\n' > "$SB/state/state"
seed_rules 192.168.179.1
run_app boot.sh
if jrnl 'boot-reconcile pointer=on delegated=keeper'; then ok "boot-on-delegates: delegation journal"; else no "boot-on-delegates: delegation journal" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
n=0; kp=""
while [ "$n" -lt 100 ]; do
  kp=$(cat "$SB/state/keeper.pid" 2>/dev/null || true)
  if [ -n "$kp" ] && kill -0 "$kp" 2>/dev/null; then break; fi
  sleep 0.2; n=$((n+1))
done
if [ -n "$kp" ] && kill -0 "$kp" 2>/dev/null; then ok "boot-on-delegates: keeper live"; else no "boot-on-delegates: keeper live" "keeper.pid=$kp"; fi
n=0; gp=""
while [ "$n" -lt 100 ]; do
  gp=$(cat "$SB/state/guard.pid" 2>/dev/null || true)
  if [ -n "$gp" ] && kill -0 "$gp" 2>/dev/null; then break; fi
  sleep 0.2; n=$((n+1))
done
if [ -n "$gp" ] && kill -0 "$gp" 2>/dev/null; then ok "boot-on-delegates: guard live"; else no "boot-on-delegates: guard live" "guard.pid=$gp"; fi
stop_t4

# ==================== S3 review-fix coverage ====================
# Fix 1 (S4 T5): runtime upstream config — materialize substitution only; the dead
# dnscrypt [static] stamp was dropped, forwarding_rules carries all resolution.
# Fix 2: keeper stale-lock recovery, live-lock skip, apply signal trap.
# Fix 4: checked materialize (upstream-change + restart paths).
# Fix 7: fixed-key state_get / literal cmdline_has.
# Residuals (scoped re-review): literal state_set keys, empty-pid lock not stolen.

probe_run() {  # probe_run <helper> [args...] — call a common.sh helper via probe.sh
  env PATH="$SB/bin:$BASE_PATH" LGTVB_STATE_DIR="$SB/state" LGTVB_HOOK_DIR="$SB/hookdir" \
    LGTVB_DNSQ="$SB/bin/dnsq" LGTVB_FILTER_BIN="$SB/bin/fake-dnscrypt-proxy" \
    LGTVB_TARGETS_FILE="$SB/targets" \
    TEST_LOG="$TEST_LOG" TEST_IPT_STATE="$TEST_IPT_STATE" \
    "$SH" "$SB/appdir/scripts/probe.sh" "$@"
}

# --- Fix 1: materialize — explicit no-upstream failure + token-free render -----
# (S4 T5: the stamp-encoder vectors were retired with [static]; forwarding_rules
# and the generic leftover-token guard carry this coverage now.)
new_app_sandbox
OUT="$(probe_run materialize '')"
if [ "$(printf '%s\n' "$OUT" | sed -n '1p')" = "rc=1" ] && [ ! -f "$SB/state/dnscrypt-proxy.toml" ]; then ok "materialize: empty upstream → rc 1, nothing written"; else no "materialize: empty upstream → rc 1, nothing written" "got [$OUT]"; fi
if jrnl 'materialize-fail reason=no-upstream'; then ok "materialize: clear journal reason"; else no "materialize: clear journal reason" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
OUT="$(probe_run materialize 192.168.5.5)"
if [ "$(printf '%s\n' "$OUT" | sed -n '1p')" = "rc=0" ] && grep -q '^\. 192\.168\.5\.5$' "$SB/state/forward-rules.txt" 2>/dev/null; then ok "materialize: forward-rules match learned upstream"; else no "materialize: forward-rules match learned upstream" "got [$OUT] $(cat "$SB/state/forward-rules.txt" 2>/dev/null)"; fi
if ! grep -qF '@' "$SB/state/dnscrypt-proxy.toml" 2>/dev/null && ! grep -q 'sdns://' "$SB/state/dnscrypt-proxy.toml" 2>/dev/null && ! grep -qF '[static]' "$SB/state/dnscrypt-proxy.toml" 2>/dev/null; then ok "materialize: rendered config token-free (no @, sdns://, [static])"; else no "materialize: rendered config token-free (no @, sdns://, [static])" "$(grep -nF '@' "$SB/state/dnscrypt-proxy.toml" 2>/dev/null; grep -n 'sdns://\|\[static\]' "$SB/state/dnscrypt-proxy.toml" 2>/dev/null)"; fi
if ! grep -q '192\.168\.179\.' "$FILTER_SRC/dnscrypt-proxy.toml.template" "$FILTER_SRC/forward-rules.txt.template"; then ok "templates: shipped templates carry no hardcoded IP"; else no "templates: shipped templates carry no hardcoded IP" "$(grep -Hn '192\.168\.179\.' "$FILTER_SRC/dnscrypt-proxy.toml.template" "$FILTER_SRC/forward-rules.txt.template")"; fi
cleanup_app_sandbox

# --- S4 T5: leftover '@' token → materialize fails with reason=token-left -------
new_app_sandbox
printf '@LEFTOVER@\n' > "$SB/appdir/filter/dnscrypt-proxy.toml.template"
run_app apply.sh
assert_result "token-left: apply fail/materialize" fail materialize
if jrnl 'materialize-fail reason=token-left'; then ok "token-left: journal reason"; else no "token-left: journal reason" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
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

# --- residual: state_set writes keys literally (no regex/glob corruption) -----
new_app_sandbox
printf 'upXstream=WRONG\nup.stream=RIGHT\nother=KEEP\n' > "$SB/state/state"
OUT="$(probe_run state_set 'up.stream' NEW)"
if [ "$(printf '%s\n' "$OUT" | sed -n '1p')" = "rc=0" ]; then ok "state_set: metachar key write rc=0"; else no "state_set: metachar key write rc=0" "got [$OUT]"; fi
if grep -qxF 'upXstream=WRONG' "$SB/state/state"; then ok "state_set: sibling key survives (dot key)"; else no "state_set: sibling key survives (dot key)" "$(cat "$SB/state/state")"; fi
if [ "$(grep -c '^up\.stream=' "$SB/state/state")" = "1" ] && grep -qxF 'up.stream=NEW' "$SB/state/state"; then ok "state_set: exact key replaced once"; else no "state_set: exact key replaced once" "$(cat "$SB/state/state")"; fi
if grep -qxF 'other=KEEP' "$SB/state/state"; then ok "state_set: unrelated key survives"; else no "state_set: unrelated key survives" "$(cat "$SB/state/state")"; fi
printf 'x=KEEP\nx*=OLD\n' > "$SB/state/state"    # glob metachar in the key
OUT="$(probe_run state_set 'x*' NEW)"
if grep -qxF 'x=KEEP' "$SB/state/state" && [ "$(grep -c '^x\*=' "$SB/state/state")" = "1" ] && grep -qxF 'x*=NEW' "$SB/state/state"; then ok "state_set: glob metachar key cannot corrupt other keys"; else no "state_set: glob metachar key cannot corrupt other keys" "$(cat "$SB/state/state")"; fi
cleanup_app_sandbox

# --- residual: empty-pid lock is treated as live (not stolen) ------------------
new_app_sandbox
mkdir -p "$SB/state/lock"                        # no pid file: crash mid-write
t0="$(date +%s)"
run_app apply.sh
t1="$(date +%s)"
assert_result "apply empty-pid lock: fail/locked" fail locked
if [ -d "$SB/state/lock" ]; then ok "apply empty-pid lock: not stolen (lock intact)"; else no "apply empty-pid lock: not stolen (lock intact)" "lock dir removed"; fi
if [ ! -s "$SB/state/lock/pid" ]; then ok "apply empty-pid lock: no pid planted"; else no "apply empty-pid lock: no pid planted" "pid=$(cat "$SB/state/lock/pid" 2>/dev/null)"; fi
if [ ! -s "$TEST_LOG" ]; then ok "apply empty-pid lock: no rule changes"; else no "apply empty-pid lock: no rule changes" "$(head -3 "$TEST_LOG")"; fi
# Same bound as the live-holder case: 10 lock iterations x sleep 1.
if [ $((t1 - t0)) -le 20 ]; then ok "apply empty-pid lock: bounded wait (<=20s)"; else no "apply empty-pid lock: bounded wait (<=20s)" "took $((t1 - t0))s"; fi
cleanup_app_sandbox

# ==================== S3.1 (T8 fix wave) ====================
# F1: upstream_learn must survive REAL pretty-printed output (the old `luna-send
# -f` on G1 pretty-prints JSON; the space-intolerant sed returned empty).
new_app_sandbox
blocked="$(grep -m1 '^=' "$SB/appdir/filter/filter-input.txt" | cut -c2-)"
printf '%s 2\n' "$blocked" > "$TEST_DNSQ_NAME_RC"
printf '%s\n' \
  '{' \
  '  "returnValue": true,' \
  '  "dns1": "192.168.7.7",' \
  '  "dns2": "192.168.9.1",' \
  '  "dns3": "fd4d:c8d7:eb60::1"' \
  '}' > "$SB/luna-pretty.json"
TEST_LUNA_FILE="$SB/luna-pretty.json"
run_app apply.sh
assert_result "F1 pretty luna output: on/verified" on verified
if printf '%s\n' "$OUT" | grep -q '^upstream=192.168.7.7$'; then ok "F1 pretty luna output: upstream echoed"; else no "F1 pretty luna output: upstream echoed" "OUT: $OUT"; fi
if chk_state '^upstream=192.168.7.7$'; then ok "F1 pretty luna output: upstream stored"; else no "F1 pretty luna output: upstream stored" "state: $(cat "$SB/state/state" 2>/dev/null)"; fi
if grep -q 'luna-send -n 1 luna://com.webos.service.connectionmanager/getStatus' "$TEST_LOG"; then ok "F1 luna call: -n 1 + getStatus"; else no "F1 luna call: -n 1 + getStatus" "$(grep 'luna-send' "$TEST_LOG" 2>/dev/null | head -2)"; fi
if ! grep -q 'luna-send.*-f' "$TEST_LOG"; then ok "F1 luna call: -f flag dropped"; else no "F1 luna call: -f flag dropped" "$(grep 'luna-send' "$TEST_LOG")"; fi
cleanup_app_sandbox

# F2 (T8): permission layout — dir 0711 (traverse-only, no listing) + exactly
# the modes the uid99 filter needs; sensitive files stay 0600. MSYS cannot
# represent POSIX modes (stat always reports 644/755), so the numeric checks
# run on Linux/CI only; the two structural checks run everywhere.
new_app_sandbox
blocked="$(grep -m1 '^=' "$SB/appdir/filter/filter-input.txt" | cut -c2-)"
printf '%s 2\n' "$blocked" > "$TEST_DNSQ_NAME_RC"
run_app apply.sh
assert_result "F2 apply sanity: on/verified" on verified
if [ -f "$SB/state/blocked-names.log" ]; then ok "F2 blocked-names.log pre-created (uid99 cannot create)"; else no "F2 blocked-names.log pre-created (uid99 cannot create)" "missing"; fi
if [ -f "$SB/state/filter.log" ]; then ok "F2 filter.log present"; else no "F2 filter.log present" "missing"; fi
case "$(uname -s 2>/dev/null)" in
  MINGW*|MSYS*|CYGWIN*)
    printf 'SKIP: F2 mode table — MSYS stat does not reflect chmod (CI is authoritative)\n'
    ;;
  *)
    mode_of() { stat -c %a "$1" 2>/dev/null; }
    chk_mode() { if [ "$(mode_of "$2")" = "$3" ]; then ok "$1"; else no "$1" "want $3 got $(mode_of "$2")"; fi; }
    chk_mode "F2 mode: STATE dir 711 (traverse-only)" "$SB/state" "711"
    chk_mode "F2 mode: toml 644" "$SB/state/dnscrypt-proxy.toml" "644"
    chk_mode "F2 mode: forward-rules 644" "$SB/state/forward-rules.txt" "644"
    chk_mode "F2 mode: filter-input 644" "$SB/state/filter-input.txt" "644"
    chk_mode "F2 mode: filter.log 666" "$SB/state/filter.log" "666"
    chk_mode "F2 mode: blocked-names.log 666" "$SB/state/blocked-names.log" "666"
    chk_mode "F2 mode: state stays 600" "$SB/state/state" "600"
    chk_mode "F2 mode: journal.log stays 600" "$SB/state/journal.log" "600"
    # nit (T8 review): supervisor logs are pre-created by ensure_state, so their
    # mode already holds from the first write (previously tightened only on the
    # next ensure_state pass).
    chk_mode "F2 mode: keeper.log stays 600" "$SB/state/keeper.log" "600"
    chk_mode "F2 mode: guard.log stays 600" "$SB/state/guard.log" "600"
    # an ensure_state pass (keeper/boot startup) must not clobber the layout
    OUT="$(probe_run ensure)"
    chk_mode "F2 mode: STATE still 711 after ensure_state" "$SB/state" "711"
    chk_mode "F2 mode: filter.log still 666 after ensure_state" "$SB/state/filter.log" "666"
    chk_mode "F2 mode: toml still 644 after ensure_state" "$SB/state/dnscrypt-proxy.toml" "644"
    ;;
esac
cleanup_app_sandbox

# F3 (T8): a one-shot xtables-lock failure during rules re-add must NOT be
# terminal — the bounded retry recovers (T8 path A attempt 1 regression).
new_app_sandbox
printf 'upstream=192.168.179.1\ncap=dnat\npointer=on\n' > "$SB/state/state"
seed_rules 192.168.179.1
start_fake_filter
TEST_DNSQ_IPT_GATE=1
TEST_IPT_LOCK_ONCE="-t nat -I OUTPUT 1 -j LGTVBLK"
run_bg keeper.sh; KEEPER_PID=$LAST_BG_PID
sleep 0.6
kill -9 "$(cat "$SB/state/filter.pid" 2>/dev/null)" 2>/dev/null
if wait_for "$SB/state/journal.log" 'keeper-recovered' 300; then ok "F3 keeper retry: recovered after lock hit"; else no "F3 keeper retry: recovered after lock hit" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
if jrnl 'rules-retry-ok n=2'; then ok "F3 keeper retry: retry logged (n=2)"; else no "F3 keeper retry: retry logged (n=2)" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
if ! jrnl 'terminal-giveup'; then ok "F3 keeper retry: no terminal give-up"; else no "F3 keeper retry: no terminal give-up" "$(grep terminal-giveup "$SB/state/journal.log")"; fi
inat="$(grep -c 'iptables -t nat -I OUTPUT 1 -j LGTVBLK$' "$TEST_LOG" 2>/dev/null || true)"
if [ "${inat:-0}" -ge 2 ]; then ok "F3 keeper retry: failed + successful insert seen (2x)"; else no "F3 keeper retry: failed + successful insert seen (2x)" "count=$inat"; fi
if [ -e "$TEST_IPT_STATE.lockfired" ]; then ok "F3 keeper retry: lock error actually fired once"; else no "F3 keeper retry: lock error actually fired once" "no marker"; fi
if chk_state '^pointer=on$' && [ ! -e "$SB/state/gaveup" ]; then ok "F3 keeper retry: stays ON, no gaveup"; else no "F3 keeper retry: stays ON, no gaveup" "state: $(cat "$SB/state/state" 2>/dev/null)"; fi
TEST_DNSQ_IPT_GATE=""; TEST_IPT_LOCK_ONCE=""
stop_t4

# F3: the apply path gets the same bounded retry (first attempt hits the lock).
new_app_sandbox
TEST_DNSQ_IPT_GATE=1
TEST_IPT_LOCK_ONCE="-t nat -I OUTPUT 1 -j LGTVBLK"
run_app apply.sh
assert_result "F3 apply retry: on/verified after lock hit" on verified
if jrnl 'rules-retry-ok n=2'; then ok "F3 apply retry: retry logged (n=2)"; else no "F3 apply retry: retry logged (n=2)" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
inat="$(grep -c 'iptables -t nat -I OUTPUT 1 -j LGTVBLK$' "$TEST_LOG" 2>/dev/null || true)"
if [ "${inat:-0}" -ge 2 ]; then ok "F3 apply retry: failed + successful insert seen (2x)"; else no "F3 apply retry: failed + successful insert seen (2x)" "count=$inat"; fi
TEST_DNSQ_IPT_GATE=""; TEST_IPT_LOCK_ONCE=""
cleanup_app_sandbox

# B-budget (T8): binary gone + filter dead → deterministic fast terminal, no
# restart loop, <=60 s (acceptance number) with the PRODUCTION tick (5 s).
new_app_sandbox
printf 'upstream=192.168.179.1\ncap=dnat\npointer=on\n' > "$SB/state/state"
seed_rules 192.168.179.1
FILTER_STUB_BIN="$SB/bin/absent-dnscrypt-proxy"
make_dead_pid
echo "$DEAD_PID" > "$SB/state/filter.pid"
TICK_OVERRIDE=5
t0="$(date +%s)"
run_bg keeper.sh; KEEPER_PID=$LAST_BG_PID
if wait_for "$SB/state/journal.log" 'terminal-giveup reason=filter-binary-missing' 100; then
  t1="$(date +%s)"
  if [ $((t1 - t0)) -le 60 ]; then ok "B-budget: terminal <=60s (got $((t1 - t0))s, TICK=5)"; else no "B-budget: terminal <=60s" "took $((t1 - t0))s"; fi
else
  no "B-budget: terminal <=60s" "never reached: $(cat "$SB/state/journal.log" 2>/dev/null)"
fi
TICK_OVERRIDE=""
if ! jrnl 'keeper-restart'; then ok "B-budget: no restart attempts (restart loop skipped)"; else no "B-budget: no restart attempts (restart loop skipped)" "$(grep 'keeper-restart' "$SB/state/journal.log")"; fi
if ! grep -q 'filter-start' "$TEST_LOG" 2>/dev/null; then ok "B-budget: filter never (re)started"; else no "B-budget: filter never (re)started" "$(grep 'filter-start' "$TEST_LOG")"; fi
if chk_state '^pointer=off$' && [ -f "$SB/state/gaveup" ]; then ok "B-budget: pointer=off + gaveup marker"; else no "B-budget: pointer=off + gaveup marker" "state: $(cat "$SB/state/state" 2>/dev/null)"; fi
stop_t4

# ==================== S4 T4: dnsq.sh nc fallback (node-optional canaries) ====================

run_dnsq_nc() {  # run_dnsq_nc <response-file> [name] [server] [port]
  SB_NC="$(mktemp -d "$SB_ROOT/nc.XXXXXX")"
  printf '#!/bin/sh\ncat "$NC_RESPONSE_FILE"\n' > "$SB_NC/nc"
  chmod +x "$SB_NC/nc"
  export NC_RESPONSE_FILE="$1"
  OUT="$(env PATH="$SB_NC:/usr/bin:/bin" NC_RESPONSE_FILE="$1" sh "$SCRIPTS_SRC/dnsq.sh" "${2:-example.com}" "${3:-127.0.0.1}" "${4:-53}" 2>&1)"
  RC=$?
}

new_app_sandbox
# NOERROR: flags-high 0x80 (byte index 3 via od $4) → rcode 0
printf '\022\064\200\200\000\001\000\000\000\000\000\000' > "$SB/nc-noerror.bin"
run_dnsq_nc "$SB/nc-noerror.bin"
if [ "$RC" -eq 0 ] && printf '%s\n' "$OUT" | grep -q 'rcode=0'; then ok "dnsq nc: NOERROR fixture → rc 0 rcode=0"; else no "dnsq nc: NOERROR fixture → rc 0 rcode=0" "rc=$RC out=[$OUT]"; fi
# REFUSED: flags-high 0x85 → rcode 5
printf '\022\064\200\205\000\001\000\000\000\000\000\000' > "$SB/nc-refused.bin"
run_dnsq_nc "$SB/nc-refused.bin"
if [ "$RC" -eq 2 ] && printf '%s\n' "$OUT" | grep -q 'rcode=5'; then ok "dnsq nc: REFUSED fixture → rc 2 rcode=5"; else no "dnsq nc: REFUSED fixture → rc 2 rcode=5" "rc=$RC out=[$OUT]"; fi
# empty response → timeout
: > "$SB/nc-empty.bin"
run_dnsq_nc "$SB/nc-empty.bin"
if [ "$RC" -eq 1 ] && printf '%s\n' "$OUT" | grep -q 'TIMEOUT'; then ok "dnsq nc: empty response → rc 1 TIMEOUT"; else no "dnsq nc: empty response → rc 1 TIMEOUT" "rc=$RC out=[$OUT]"; fi
# 2-byte short response (no byte index 3) → timeout, not a bogus rcode
printf '\022\064' > "$SB/nc-short.bin"
run_dnsq_nc "$SB/nc-short.bin"
if [ "$RC" -eq 1 ] && printf '%s\n' "$OUT" | grep -q 'TIMEOUT'; then ok "dnsq nc: short response → rc 1 TIMEOUT"; else no "dnsq nc: short response → rc 1 TIMEOUT" "rc=$RC out=[$OUT]"; fi
cleanup_app_sandbox

# --- Summary -----------------------------------------------------------------
printf '\n%s passed, %s failed\n' "$pass" "$fail"
if [ "$fail" -ne 0 ]; then
  exit 1
fi
exit 0
