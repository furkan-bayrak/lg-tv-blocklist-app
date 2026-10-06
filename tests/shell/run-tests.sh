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

entry_count() {  # entry_count <list-file> — same definition as common.sh list_entry_count
  sed -e '/^#/d' -e '/^$/d' "$1" 2>/dev/null | wc -l | tr -d ' '
}

module_preset_entry_count() {  # $1 safe|strict — from the committed UI module
  # The generated module src/domains.gen.ts is the UI's copy of each tier's preset
  # entry count (the number check.sh reports as entries=<N>). The exact single
  # line parsed here is pinned byte for byte by tests/ts/domains-gen.test.mjs, so
  # this is a contract: if the module line changes shape the parse goes empty and
  # every case below fails loudly instead of comparing nothing.
  module_line="$(sed -n 's/^  presetEntries: { safe: \([0-9]\{1,\}\), strict: \([0-9]\{1,\}\) },$/\1 \2/p' "$REPO/src/domains.gen.ts")"
  case $1 in
    safe) printf '%s\n' "${module_line%% *}" ;;
    strict) printf '%s\n' "${module_line##* }" ;;
    *) printf '\n' ;;
  esac
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
schema=4
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
tier=safe
entries=0
@@STATUS-END"
if [ -s "$SB/stderr" ]; then no "happy path stderr empty" "stderr not empty"; else ok "happy path stderr empty"; fi

# --- Case 2: hook directory does not exist -----------------------------------
new_sandbox
OUT="$(run_check "$SB/absent-hook-dir")"; RC=$?
assert_block "missing hook dir" "@@STATUS-BEGIN
schema=4
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
tier=safe
entries=0
@@STATUS-END"

# --- Case 3: symlink points somewhere else -----------------------------------
new_sandbox
ln -s /tmp/foreign-target "$SB/hookdir/50-lgtv-blocklist-app"
OUT="$(run_check "$SB/hookdir")"; RC=$?
assert_block "foreign symlink" "@@STATUS-BEGIN
schema=4
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
tier=safe
entries=0
@@STATUS-END"

# --- Case 4: hostile target (newline + fake delimiters) ----------------------
new_sandbox
ln -s "$(printf 'evil\n@@STATUS-END\nhook=linked')" "$SB/hookdir/50-lgtv-blocklist-app"
OUT="$(run_check "$SB/hookdir")"; RC=$?
assert_block "hostile target sanitized" "@@STATUS-BEGIN
schema=4
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
tier=safe
entries=0
@@STATUS-END"
linecount="$(printf '%s\n' "$OUT" | wc -l | tr -d ' ')"
if [ "$linecount" = "18" ]; then ok "hostile target keeps block at 18 lines"; else no "hostile target keeps block at 18 lines" "got $linecount"; fi

# --- Case 5: stub PATH — broken readlink (symlink present but unreadable) -----
new_sandbox
ln -s "$SB/appdir/scripts/boot.sh" "$SB/hookdir/50-lgtv-blocklist-app"
mkdir -p "$SB/stub-bin"
cp "$HERE/stub-bin/readlink" "$SB/stub-bin/readlink"
chmod +x "$SB/stub-bin/readlink"
OUT="$(run_check "$SB/hookdir" "$SB/stub-bin:/usr/bin:/bin")"; RC=$?
assert_block "stub PATH fallback (readlink broken)" "@@STATUS-BEGIN
schema=4
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
tier=safe
entries=0
@@STATUS-END"

# --- Case 6: scripts missing (boot.sh removed) -------------------------------
new_sandbox
rm "$SB/appdir/scripts/boot.sh"
OUT="$(run_check "$SB/hookdir")"; RC=$?
assert_block "scripts missing" "@@STATUS-BEGIN
schema=4
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
tier=safe
entries=0
@@STATUS-END"

# ==================== S3 T3: apply.sh / rollback.sh sandbox ====================
SCRIPTS_SRC="$REPO/app/scripts"
FILTER_SRC="$REPO/app/filter"
STUBBIN="$HERE/stub-bin"
BASE_PATH="$PATH"

new_app_sandbox() {
  SB="$(mktemp -d "$SB_ROOT/sb.XXXXXX")"
  mkdir -p "$SB/appdir/scripts" "$SB/appdir/filter" "$SB/hookdir" "$SB/state" "$SB/bin"
  cp "$SCRIPTS_SRC/common.sh" "$SCRIPTS_SRC/apply.sh" "$SCRIPTS_SRC/rollback.sh" "$SCRIPTS_SRC/keeper.sh" "$SCRIPTS_SRC/guard.sh" "$SCRIPTS_SRC/check.sh" "$SCRIPTS_SRC/boot.sh" "$SCRIPTS_SRC/dnsq.sh" "$SCRIPTS_SRC/tier.sh" "$SCRIPTS_SRC/overrides.sh" "$SB/appdir/scripts/"
  cp "$FILTER_SRC/dnscrypt-proxy.toml.template" "$FILTER_SRC/forward-rules.txt.template" "$FILTER_SRC/filter-input.txt" "$FILTER_SRC/domains.json" "$SB/appdir/filter/"
  cp "$STUBBIN/iptables" "$STUBBIN/luna-send" "$STUBBIN/dnsq" "$STUBBIN/node" "$STUBBIN/fake-dnscrypt-proxy" "$STUBBIN/fake-dnscrypt-proxy-dead" "$SB/bin/"
  chmod +x "$SB/appdir/scripts/apply.sh" "$SB/appdir/scripts/rollback.sh" "$SB/appdir/scripts/keeper.sh" "$SB/appdir/scripts/guard.sh" "$SB/appdir/scripts/check.sh" "$SB/appdir/scripts/boot.sh" "$SB/appdir/scripts/dnsq.sh" "$SB/appdir/scripts/tier.sh" "$SB/appdir/scripts/overrides.sh" "$SB/bin/iptables" "$SB/bin/luna-send" "$SB/bin/dnsq" "$SB/bin/node" "$SB/bin/fake-dnscrypt-proxy" "$SB/bin/fake-dnscrypt-proxy-dead"
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
    '  dnsq) shift; dnsq "$@"; echo "rc=$?" ;;' \
    '  uwait) printf "%s %s\n" "$UWAIT_ROUNDS" "$UWAIT_SLEEP" ;;' \
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
  # UWAIT pins (same pair as run_bg): boot.sh-spawned keepers inherit this list, so
  # keep the wait budget fast + independent of the shipped default.
  OUT="$(env PATH="$SB/bin:$BASE_PATH" \
    LGTVB_STATE_DIR="$SB/state" LGTVB_HOOK_DIR="$SB/hookdir" \
    LGTVB_DNSQ="$SB/bin/dnsq" LGTVB_FILTER_BIN="$SB/bin/fake-dnscrypt-proxy" \
    LGTVB_TICK=1 LGTVB_GUARD_TICK=1 LGTVB_TARGETS_FILE="$SB/targets" \
    LGTVB_UWAIT_ROUNDS=2 LGTVB_UWAIT_SLEEP=1 \
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
# S4 T7 regression anchor: dnscrypt-proxy hard-FATALs with 0 registered servers
# ("None of the servers ... were found in the configured sources") - forwarding
# rules do NOT count. offline_mode=true is the render-level guard.
if grep -qx 'offline_mode = true' "$SB/state/dnscrypt-proxy.toml" 2>/dev/null; then ok "apply happy path: offline_mode=true rendered (0-server startup guard)"; else no "apply happy path: offline_mode=true rendered (0-server startup guard)" "$(grep -n 'offline_mode' "$SB/state/dnscrypt-proxy.toml" 2>/dev/null || echo 'no offline_mode line')"; fi
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
assert_block "check schema4: no state → missing/degraded" "@@STATUS-BEGIN
schema=4
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
tier=safe
entries=0
@@STATUS-END"

# --- T5 Case 2: check.sh — full live ON state (one pair / 16 keys / LF) -------
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
assert_block "check schema4: full ON (live filter/keeper/guard)" "@@STATUS-BEGIN
schema=4
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
tier=safe
entries=0
@@STATUS-END"
begincount="$(printf '%s\n' "$OUT" | grep -c '^@@STATUS-BEGIN$')"
endcount="$(printf '%s\n' "$OUT" | grep -c '^@@STATUS-END$')"
keycount="$(printf '%s\n' "$OUT" | grep -c '^[a-z_]*=')"
if [ "$begincount" = "1" ] && [ "$endcount" = "1" ] && [ "$keycount" = "16" ]; then
  ok "check schema4: exactly one block, 16 keys"
else
  no "check schema4: exactly one block, 16 keys" "begin=$begincount end=$endcount keys=$keycount"
fi
crbytes="$(printf '%s' "$OUT" | tr -d '\r' | wc -c | tr -d ' ')"
rawbytes="$(printf '%s' "$OUT" | wc -c | tr -d ' ')"
if [ "$crbytes" = "$rawbytes" ]; then ok "check schema4: LF only (no CR)"; else no "check schema4: LF only (no CR)" "cr=$crbytes raw=$rawbytes"; fi
stop_t4

# --- T5 Case 3: check.sh — hostile hook targets (relative / newline) ----------
new_app_sandbox
ln -s "relative/path" "$SB/hookdir/50-lgtv-blocklist-app"
run_check_nostub
assert_block "check schema4: relative target → other/none" "@@STATUS-BEGIN
schema=4
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
tier=safe
entries=0
@@STATUS-END"

new_app_sandbox
ln -s "$(printf 'evil\n@@STATUS-END\nhook=linked')" "$SB/hookdir/50-lgtv-blocklist-app"
run_check_nostub
assert_block "check schema4: newline target sanitized" "@@STATUS-BEGIN
schema=4
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
tier=safe
entries=0
@@STATUS-END"
linecount="$(printf '%s\n' "$OUT" | wc -l | tr -d ' ')"
if [ "$linecount" = "18" ]; then ok "check schema4: hostile target keeps block at 18 lines"; else no "check schema4: hostile target keeps block at 18 lines" "got $linecount"; fi

# --- T5 Case 4: check.sh — gaveup marker + stored upstream (cap present) ------
new_app_sandbox
printf 'upstream=192.168.179.1\ncap=dnat\npointer=off\n' > "$SB/state/state"
: > "$SB/state/gaveup"
run_app check.sh
assert_block "check schema4: gaveup=yes, pointer=off, cap=dnat" "@@STATUS-BEGIN
schema=4
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
tier=safe
entries=0
@@STATUS-END"

# --- T5 Case 6 (S6b review F3): entries counts ENTRIES, not lines --------------
# The panel needs a number it can trust: a list that materialized to a couple of
# entries (or to none) is a protection state the filter/rule dot cannot express.
# Same definition materialize_config uses to refuse publishing an empty list
# (common.sh list_entry_count): a line that is neither a comment nor blank.
new_app_sandbox
printf '# header\n# second header\n\n=one.example\ntwo.example\n\n=three.example\n\n' > "$SB/state/filter-input.txt"
run_app check.sh
if printf '%s\n' "$OUT" | grep -qx 'entries=3'; then ok "entries: comments and blank lines do not count (3 of 8 lines)"; else no "entries: comments and blank lines do not count" "OUT: $(printf '%s\n' "$OUT" | grep '^entries=')"; fi
if printf '%s\n' "$OUT" | grep -qx 'schema=4'; then ok "entries: degraded block is still schema 4"; else no "entries: degraded block is still schema 4" "OUT: $(printf '%s\n' "$OUT" | tr '\n' ' ')"; fi
printf '# only comments\n\n' > "$SB/state/filter-input.txt"
run_app check.sh
if printf '%s\n' "$OUT" | grep -qx 'entries=0'; then ok "entries: a comment-only list reports 0, not a line count"; else no "entries: a comment-only list reports 0" "OUT: $(printf '%s\n' "$OUT" | grep '^entries=')"; fi
rm -f "$SB/state/filter-input.txt"
run_app check.sh
if printf '%s\n' "$OUT" | grep -qx 'entries=0'; then ok "entries: no materialized list reports 0"; else no "entries: no materialized list reports 0" "OUT: $(printf '%s\n' "$OUT" | grep '^entries=')"; fi
cleanup_app_sandbox

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
# S4 T7 regression: the render-level guard for the 0-registered-servers FATAL.
# Render anchor only - the sandbox has no dnscrypt binary; runtime proof is the
# T7 resume on the G1 (filter starts + canaries resolve/refuse).
if grep -qx 'offline_mode = true' "$SB/state/dnscrypt-proxy.toml" 2>/dev/null; then ok "materialize: offline_mode=true rendered (0-server startup guard)"; else no "materialize: offline_mode=true rendered (0-server startup guard)" "$(cat "$SB/state/dnscrypt-proxy.toml" 2>/dev/null)"; fi
if grep -q 'registered server' "$FILTER_SRC/dnscrypt-proxy.toml.template" 2>/dev/null; then ok "template: offline_mode reason comment present"; else no "template: offline_mode reason comment present" "no reason comment in $FILTER_SRC/dnscrypt-proxy.toml.template"; fi
if ! grep -q '192\.168\.179\.' "$FILTER_SRC/dnscrypt-proxy.toml.template" "$FILTER_SRC/forward-rules.txt.template"; then ok "templates: shipped templates carry no hardcoded IP"; else no "templates: shipped templates carry no hardcoded IP" "$(grep -Hn '192\.168\.179\.' "$FILTER_SRC/dnscrypt-proxy.toml.template" "$FILTER_SRC/forward-rules.txt.template")"; fi
cleanup_app_sandbox

# --- S4 T5: leftover '@' token → materialize fails with reason=token-left -------
new_app_sandbox
printf '@LEFTOVER@\n' > "$SB/appdir/filter/dnscrypt-proxy.toml.template"
run_app apply.sh
assert_result "token-left: apply fail/materialize" fail materialize
if jrnl 'materialize-fail reason=token-left'; then ok "token-left: journal reason"; else no "token-left: journal reason" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
cleanup_app_sandbox

# ==================== S6a T2: tier selection + override merge ==================
# The shipped bundle carries one preset list per tier (app/filter/filter-input-
# <tier>.txt); the legacy single filter-input.txt is what a bundle older than
# tiers ships, so it stays the fallback. Every sandbox ABOVE ships only
# filter-input.txt on purpose — the whole suite above is therefore the fallback
# path — while these cases copy the real tier presets in and exercise the
# selection, the default, and the override merge.
tier_sandbox() {  # new_app_sandbox + the two real tier presets
  new_app_sandbox
  cp "$FILTER_SRC/filter-input-safe.txt" "$FILTER_SRC/filter-input-strict.txt" "$SB/appdir/filter/"
}

# --- T2 case 1: no tier key at all → SAFE (fresh install = gentler list) ------
tier_sandbox
: > "$SB/state/state"
OUT="$(probe_run materialize 192.168.5.5)"
if [ "$(printf '%s\n' "$OUT" | sed -n '1p')" = "rc=0" ]; then ok "tier default: materialize rc 0"; else no "tier default: materialize rc 0" "got [$OUT]"; fi
if cmp -s "$SB/state/filter-input.txt" "$SB/appdir/filter/filter-input-safe.txt"; then ok "tier default: unset tier copies the SAFE preset byte for byte"; else no "tier default: unset tier copies the SAFE preset byte for byte" "diff: $(diff "$SB/state/filter-input.txt" "$SB/appdir/filter/filter-input-safe.txt" 2>&1 | head -3)"; fi
if ! jrnl 'materialize-fallback'; then ok "tier default: no fallback taken (tier file present)"; else no "tier default: no fallback taken (tier file present)" "$(grep materialize-fallback "$SB/state/journal.log")"; fi
run_app check.sh
if printf '%s\n' "$OUT" | grep -qx 'tier=safe'; then ok "tier default: check.sh reports tier=safe"; else no "tier default: check.sh reports tier=safe" "OUT: $(printf '%s\n' "$OUT" | tr '\n' ' ')"; fi
# S6b review F3: the block reports how many entries the effective list holds, and
# the number is derived from the file that was just materialized — never hardcoded.
safe_entries="$(entry_count "$SB/state/filter-input.txt")"
if printf '%s\n' "$OUT" | grep -qx "schema=4"; then ok "entries: the block is schema 4"; else no "entries: the block is schema 4" "OUT: $(printf '%s\n' "$OUT" | tr '\n' ' ')"; fi
if printf '%s\n' "$OUT" | grep -qx "entries=$safe_entries"; then ok "entries: SAFE reports the materialized list's real count (${safe_entries} of $(wc -l < "$SB/state/filter-input.txt" | tr -d ' ') lines)"; else no "entries: SAFE reports the materialized list's real count" "want entries=$safe_entries, got $(printf '%s\n' "$OUT" | grep '^entries=')"; fi
# S6b T7/T8 enablement: the committed UI module is what the UI renders the count
# from, check.sh is what it reports — for the same shipped preset they are one
# number, and the module's copy is derived from the same list with the same rule.
md_safe="$(module_preset_entry_count safe)"
if [ -n "$md_safe" ] && [ "$md_safe" = "$safe_entries" ]; then ok "domains.gen.ts: presetEntries.safe ($md_safe) == check.sh entries=safe"; else no "domains.gen.ts: presetEntries.safe == check.sh entries" "module=[$md_safe] check=[$safe_entries]"; fi
cleanup_app_sandbox

# --- T2 case 2: tier=strict → the strict preset + visible in @@STATUS ----------
tier_sandbox
printf 'tier=strict\n' > "$SB/state/state"
OUT="$(probe_run materialize 192.168.5.5)"
if [ "$(printf '%s\n' "$OUT" | sed -n '1p')" = "rc=0" ]; then ok "tier strict: materialize rc 0"; else no "tier strict: materialize rc 0" "got [$OUT]"; fi
if cmp -s "$SB/state/filter-input.txt" "$SB/appdir/filter/filter-input-strict.txt"; then ok "tier strict: copies the STRICT preset byte for byte"; else no "tier strict: copies the STRICT preset byte for byte" "diff: $(diff "$SB/state/filter-input.txt" "$SB/appdir/filter/filter-input-strict.txt" 2>&1 | head -3)"; fi
# The two presets must actually differ (otherwise the case is vacuous) and the
# strict one must be the only one carrying the whole-zone anchors.
if ! cmp -s "$SB/appdir/filter/filter-input-safe.txt" "$SB/appdir/filter/filter-input-strict.txt"; then ok "tier strict: presets differ (non-vacuous)"; else no "tier strict: presets differ (non-vacuous)" "safe == strict"; fi
if grep -q '^[a-z]' "$SB/state/filter-input.txt" && ! grep -q '^[a-z]' "$SB/appdir/filter/filter-input-safe.txt"; then ok "tier strict: zone anchors present in strict only"; else no "tier strict: zone anchors present in strict only" "strict anchors: $(grep -c '^[a-z]' "$SB/state/filter-input.txt")"; fi
run_check_nostub
# S6b review F3: the count is derived from the materialized strict list (its 115
# exact rules + its 8 bare zone anchors = 123 entries, and the comments do not count).
strict_entries="$(entry_count "$SB/state/filter-input.txt")"
if printf '%s\n' "$OUT" | grep -qx "entries=$strict_entries"; then ok "entries: STRICT reports the materialized list's real count ($strict_entries)"; else no "entries: STRICT reports the materialized list's real count" "want entries=$strict_entries, got $(printf '%s\n' "$OUT" | grep '^entries=')"; fi
# Same equality for the other tier: 115 exact rules + 8 bare zone anchors, as the
# UI module carries it.
md_strict="$(module_preset_entry_count strict)"
if [ -n "$md_strict" ] && [ "$md_strict" = "$strict_entries" ]; then ok "domains.gen.ts: presetEntries.strict ($md_strict) == check.sh entries=strict"; else no "domains.gen.ts: presetEntries.strict == check.sh entries" "module=[$md_strict] check=[$strict_entries]"; fi
assert_block "tier strict: check.sh block (schema 4, entries last)" "@@STATUS-BEGIN
schema=4
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
tier=strict
entries=123
@@STATUS-END"
cleanup_app_sandbox

# --- T2 case 3: legacy bundle (no tier file) → fallback, logged, still rc 0 --
new_app_sandbox            # ships filter-input.txt only = pre-tier bundle
printf 'tier=strict\n' > "$SB/state/state"
OUT="$(probe_run materialize 192.168.5.5)"
if [ "$(printf '%s\n' "$OUT" | sed -n '1p')" = "rc=0" ]; then ok "tier fallback: missing tier file is not an error"; else no "tier fallback: missing tier file is not an error" "got [$OUT]"; fi
if cmp -s "$SB/state/filter-input.txt" "$SB/appdir/filter/filter-input.txt"; then ok "tier fallback: legacy single list materialized"; else no "tier fallback: legacy single list materialized" "diff: $(diff "$SB/state/filter-input.txt" "$SB/appdir/filter/filter-input.txt" 2>&1 | head -3)"; fi
if jrnl 'materialize-fallback reason=no-tier-file tier=strict'; then ok "tier fallback: journal line names the missing tier"; else no "tier fallback: journal line names the missing tier" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
cleanup_app_sandbox

# --- T2 case 3b (review F1): a PARTIAL tier install must never fall back -----
# The legacy filter-input.txt IS the strict list (123 entries incl. 8 zone
# anchors). With the old unconditional fallback, deleting the SAFE preset on a
# SAFE-state TV silently materialized the aggressive list while state, check.sh
# and the panel all said safe. Exactly one tier file missing = damaged install:
# materialize must fail (callers fail open) and name the reason in the journal.
new_app_sandbox
cp "$FILTER_SRC/filter-input-strict.txt" "$SB/appdir/filter/"   # safe preset missing
: > "$SB/state/state"                                            # tier unset = safe
OUT="$(probe_run materialize 192.168.5.5)"
if [ "$(printf '%s\n' "$OUT" | sed -n '1p')" = "rc=1" ]; then ok "tier partial (safe missing): materialize refuses"; else no "tier partial (safe missing): materialize refuses" "got [$OUT]"; fi
if [ ! -f "$SB/state/filter-input.txt" ]; then ok "tier partial (safe missing): nothing materialized"; else no "tier partial (safe missing): nothing materialized" "$(grep -c . "$SB/state/filter-input.txt") lines"; fi
if jrnl 'materialize-fail reason=partial-tier-files tier=safe'; then ok "tier partial (safe missing): journal names the reason"; else no "tier partial (safe missing): journal names the reason" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
if ! jrnl 'materialize-fallback'; then ok "tier partial (safe missing): no silent strict fallback"; else no "tier partial (safe missing): no silent strict fallback" "$(grep materialize-fallback "$SB/state/journal.log")"; fi
run_app apply.sh
assert_result "tier partial (safe missing): apply fails open at materialize" fail materialize
cleanup_app_sandbox

# mirror case: the STRICT preset is missing while the active tier is strict ----
new_app_sandbox
cp "$FILTER_SRC/filter-input-safe.txt" "$SB/appdir/filter/"      # strict preset missing
printf 'tier=strict\n' > "$SB/state/state"
OUT="$(probe_run materialize 192.168.5.5)"
if [ "$(printf '%s\n' "$OUT" | sed -n '1p')" = "rc=1" ]; then ok "tier partial (strict missing): materialize refuses"; else no "tier partial (strict missing): materialize refuses" "got [$OUT]"; fi
if [ ! -f "$SB/state/filter-input.txt" ]; then ok "tier partial (strict missing): nothing materialized"; else no "tier partial (strict missing): nothing materialized" "$(grep -c . "$SB/state/filter-input.txt") lines"; fi
if jrnl 'materialize-fail reason=partial-tier-files tier=strict'; then ok "tier partial (strict missing): journal names the reason"; else no "tier partial (strict missing): journal names the reason" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
cleanup_app_sandbox

# both tier files missing = a bundle older than tiers: the legacy fallback is
# still the right answer there (it IS what that bundle shipped and blocked). --
new_app_sandbox
: > "$SB/state/state"
OUT="$(probe_run materialize 192.168.5.5)"
if [ "$(printf '%s\n' "$OUT" | sed -n '1p')" = "rc=0" ]; then ok "tier both-missing: legacy fallback still works"; else no "tier both-missing: legacy fallback still works" "got [$OUT]"; fi
if cmp -s "$SB/state/filter-input.txt" "$SB/appdir/filter/filter-input.txt"; then ok "tier both-missing: legacy single list materialized"; else no "tier both-missing: legacy single list materialized" "diff: $(diff "$SB/state/filter-input.txt" "$SB/appdir/filter/filter-input.txt" 2>&1 | head -3)"; fi
if jrnl 'materialize-fallback reason=no-tier-file tier=safe'; then ok "tier both-missing: fallback logged for the default tier"; else no "tier both-missing: fallback logged for the default tier" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
cleanup_app_sandbox

# --- T2 case 4: garbled / partial tier value → SAFE, never a bogus tier ------
for bogus in 'tier=aggressive' 'tier=STRICT' 'tier=' 'tier=safe '; do
  tier_sandbox
  printf '%s\n' "$bogus" > "$SB/state/state"
  OUT="$(probe_run materialize 192.168.5.5)"
  if cmp -s "$SB/state/filter-input.txt" "$SB/appdir/filter/filter-input-safe.txt"; then ok "tier garbled [$bogus]: falls back to SAFE"; else no "tier garbled [$bogus]: falls back to SAFE" "materialized $(head -4 "$SB/state/filter-input.txt" | tail -1)"; fi
  run_check_nostub
  if printf '%s\n' "$OUT" | grep -qx 'tier=safe'; then ok "tier garbled [$bogus]: check.sh reports tier=safe"; else no "tier garbled [$bogus]: check.sh reports tier=safe" "OUT: $(printf '%s\n' "$OUT" | tr '\n' ' ')"; fi
  cleanup_app_sandbox
done

# --- T2 case 5: overrides — '+name' forces an exact entry in, '-name' removes it
tier_sandbox
ov_rm="$(grep -m1 '^=' "$SB/appdir/filter/filter-input-safe.txt" | cut -c2-)"
printf '%s\n' "-$ov_rm" '+forced.example' > "$SB/state/overrides.txt"
OUT="$(probe_run materialize 192.168.5.5)"
if [ "$(printf '%s\n' "$OUT" | sed -n '1p')" = "rc=0" ]; then ok "overrides: materialize rc 0"; else no "overrides: materialize rc 0" "got [$OUT]"; fi
if grep -qx "=$ov_rm" "$SB/state/filter-input.txt"; then no "overrides: '-$ov_rm' removed the exact rule" "still present"; else ok "overrides: '-$ov_rm' removed the exact rule"; fi
if grep -qx '=forced.example' "$SB/state/filter-input.txt"; then ok "overrides: '+forced.example' added the exact rule"; else no "overrides: '+forced.example' added the exact rule" "$(tail -2 "$SB/state/filter-input.txt")"; fi
lines=$(wc -l < "$SB/state/filter-input.txt" | tr -d ' ')
preset=$(wc -l < "$SB/appdir/filter/filter-input-safe.txt" | tr -d ' ')
if [ "$lines" = "$preset" ]; then ok "overrides: one removal + one addition keeps the line count ($lines)"; else no "overrides: one removal + one addition keeps the line count ($lines)" "preset=$preset"; fi
fc=$(grep -c '^=forced.example$' "$SB/state/filter-input.txt" || true)
if [ "$fc" = "1" ]; then ok "overrides: forced entry added exactly once"; else no "overrides: forced entry added exactly once" "count=$fc"; fi
cleanup_app_sandbox

# --- T2 case 6: '-name' removes a bare zone anchor (strict tier) -------------
tier_sandbox
printf 'tier=strict\n' > "$SB/state/state"
ov_zone="$(grep -m1 '^[a-z]' "$SB/appdir/filter/filter-input-strict.txt")"
printf '%s\n' "-$ov_zone" > "$SB/state/overrides.txt"
OUT="$(probe_run materialize 192.168.5.5)"
if grep -qx "$ov_zone" "$SB/state/filter-input.txt"; then no "overrides: zone anchor removal" "still present: $ov_zone"; else ok "overrides: zone anchor removal ($ov_zone)"; fi
zcount=$(grep -c '^[a-z]' "$SB/state/filter-input.txt" | tr -d ' ')
zpreset=$(grep -c '^[a-z]' "$SB/appdir/filter/filter-input-strict.txt" | tr -d ' ')
if [ "$zcount" = "$((zpreset - 1))" ]; then ok "overrides: exactly one anchor removed ($zpreset → $zcount)"; else no "overrides: exactly one anchor removed ($zpreset → $zcount)" "got $zcount"; fi
cleanup_app_sandbox

# --- T2 case 7: empty / no-op / hostile override lines never change the list -
tier_sandbox
: > "$SB/state/overrides.txt"
probe_run materialize 192.168.5.5 >/dev/null
if cmp -s "$SB/state/filter-input.txt" "$SB/appdir/filter/filter-input-safe.txt"; then ok "overrides: empty file is a no-op"; else no "overrides: empty file is a no-op" "diff: $(diff "$SB/state/filter-input.txt" "$SB/appdir/filter/filter-input-safe.txt" 2>&1 | head -3)"; fi
cleanup_app_sandbox

tier_sandbox
# A glob must never act as a pattern (a bare '*' would wipe the list), a name
# outside [a-z0-9._-] is ignored, an unknown '-' target is a no-op, and a
# comment/junk line is ignored. None of these may fail the materialize.
printf '%s\n' '-*' '+*/etc' '+UPPER.example' '+bad;name' '-' '+' '# comment' '/abs/path' 'example.com' > "$SB/state/overrides.txt"
OUT="$(probe_run materialize 192.168.5.5)"
if [ "$(printf '%s\n' "$OUT" | sed -n '1p')" = "rc=0" ]; then ok "overrides: junk lines never fail the materialize"; else no "overrides: junk lines never fail the materialize" "got [$OUT]"; fi
if cmp -s "$SB/state/filter-input.txt" "$SB/appdir/filter/filter-input-safe.txt"; then ok "overrides: hostile lines change nothing (glob stays literal)"; else no "overrides: hostile lines change nothing (glob stays literal)" "diff: $(diff "$SB/state/filter-input.txt" "$SB/appdir/filter/filter-input-safe.txt" 2>&1 | head -3)"; fi
if [ ! -f "$SB/state/filter-input.txt.ovtmp" ]; then ok "overrides: no temp file left behind"; else no "overrides: no temp file left behind" "ovtmp present"; fi
cleanup_app_sandbox

# --- T2 case 8: a missing '-name' target is a no-op, not an error ------------
tier_sandbox
printf '%s\n' '-not-in-the-list.example' > "$SB/state/overrides.txt"
OUT="$(probe_run materialize 192.168.5.5)"
if [ "$(printf '%s\n' "$OUT" | sed -n '1p')" = "rc=0" ] && cmp -s "$SB/state/filter-input.txt" "$SB/appdir/filter/filter-input-safe.txt"; then ok "overrides: unknown '-name' is a silent no-op"; else no "overrides: unknown '-name' is a silent no-op" "got [$OUT]"; fi
cleanup_app_sandbox

# ==================== S6a T3: the tier switch entrypoint (tier.sh) ============
# tier.sh takes the only argument the app can send — a compile-time constant in
# src/bridge.ts, 'safe' or 'strict' — and writes the tier state key. Nothing
# else may steer it, and it must never touch protection: the UI re-applies
# through the existing apply.sh, so this stays a single-key write.
run_tier() {  # run_tier [args...]; sets OUT + RC — fixed entrypoint WITH argv
  OUT="$(env PATH="$SB/bin:$BASE_PATH" \
    LGTVB_STATE_DIR="$SB/state" LGTVB_HOOK_DIR="$SB/hookdir" \
    LGTVB_DNSQ="$SB/bin/dnsq" LGTVB_FILTER_BIN="$SB/bin/fake-dnscrypt-proxy" \
    LGTVB_TARGETS_FILE="$SB/targets" LGTVB_PROC_TCP="$SB/proc_tcp" \
    TEST_LOG="$TEST_LOG" TEST_IPT_STATE="$TEST_IPT_STATE" \
    "$SH" "$SB/appdir/scripts/tier.sh" "$@" 2>"$SB/stderr")"
  RC=$?
}

# --- T3 case 1: the switch writes the key, and the status block shows it ------
tier_sandbox
printf 'upstream=192.168.5.5\npointer=off\n' > "$SB/state/state"
run_tier strict
if [ "$RC" -eq 0 ]; then ok "tier.sh: 'strict' accepted (rc 0)"; else no "tier.sh: 'strict' accepted (rc 0)" "rc=$RC stderr=[$(cat "$SB/stderr")]"; fi
if chk_state '^tier=strict$'; then ok "tier.sh: writes tier=strict"; else no "tier.sh: writes tier=strict" "state: $(cat "$SB/state/state" 2>/dev/null)"; fi
if printf '%s\n' "$OUT" | grep -qx 'reason=strict'; then ok "tier.sh: echoes the fixed result block"; else no "tier.sh: echoes the fixed result block" "OUT: $(printf '%s\n' "$OUT" | tr '\n' ' ')"; fi
if jrnl 'tier-set tier=strict'; then ok "tier.sh: journals the change (audit trail)"; else no "tier.sh: journals the change (audit trail)" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
if grep -qx 'upstream=192.168.5.5' "$SB/state/state" && grep -qx 'pointer=off' "$SB/state/state"; then ok "tier.sh: sibling state keys survive"; else no "tier.sh: sibling state keys survive" "state: $(cat "$SB/state/state" 2>/dev/null)"; fi
if [ "$(grep -c '^tier=' "$SB/state/state")" = "1" ]; then ok "tier.sh: exactly one tier key"; else no "tier.sh: exactly one tier key" "state: $(cat "$SB/state/state" 2>/dev/null)"; fi
run_check_nostub
if printf '%s\n' "$OUT" | grep -qx 'tier=strict'; then ok "tier.sh: switch visible in the @@STATUS block"; else no "tier.sh: switch visible in the @@STATUS block" "OUT: $(printf '%s\n' "$OUT" | tr '\n' ' ')"; fi
# The switch alone must not start, stop, reroute or lock anything.
if [ ! -s "$TEST_LOG" ]; then ok "tier.sh: no rule/filter commands (nothing restarted)"; else no "tier.sh: no rule/filter commands (nothing restarted)" "$(head -3 "$TEST_LOG")"; fi
if [ ! -d "$SB/state/lock" ]; then ok "tier.sh: takes no lock"; else no "tier.sh: takes no lock" "lock dir present"; fi
if [ ! -f "$SB/state/filter.pid" ] && [ ! -f "$SB/state/gaveup" ]; then ok "tier.sh: no filter pid, no giveup marker"; else no "tier.sh: no filter pid, no giveup marker" "$(ls "$SB/state")"; fi
cleanup_app_sandbox

# --- T3 case 2: the switch changes the list the next materialize writes -------
tier_sandbox
: > "$SB/state/state"
run_tier strict
probe_run materialize 192.168.5.5 >/dev/null
if cmp -s "$SB/state/filter-input.txt" "$SB/appdir/filter/filter-input-strict.txt"; then ok "tier.sh strict: next materialize uses the STRICT preset"; else no "tier.sh strict: next materialize uses the STRICT preset" "diff: $(diff "$SB/state/filter-input.txt" "$SB/appdir/filter/filter-input-strict.txt" 2>&1 | head -3)"; fi
run_tier safe
if [ "$RC" -eq 0 ] && chk_state '^tier=safe$'; then ok "tier.sh: switching back to safe"; else no "tier.sh: switching back to safe" "rc=$RC state: $(cat "$SB/state/state" 2>/dev/null)"; fi
probe_run materialize 192.168.5.5 >/dev/null
if cmp -s "$SB/state/filter-input.txt" "$SB/appdir/filter/filter-input-safe.txt"; then ok "tier.sh safe: next materialize uses the SAFE preset"; else no "tier.sh safe: next materialize uses the SAFE preset" "diff: $(diff "$SB/state/filter-input.txt" "$SB/appdir/filter/filter-input-safe.txt" 2>&1 | head -3)"; fi
cleanup_app_sandbox

# --- T3 case 3: anything that is not exactly safe|strict is refused ----------
# A refused call must exit non-zero AND leave the previous tier in place: a
# half-accepted argument would let a caller believe a tier it never wrote.
tier_sandbox
printf 'tier=safe\n' > "$SB/state/state"
for bad in 'aggressive' '' 'STRICT' 'safe ' ' safe' 'strict;id' '*' './safe' 'safe\nstrict'; do
  run_tier "$bad"
  if [ "$RC" -ne 0 ]; then ok "tier.sh refuses [${bad}]"; else no "tier.sh refuses [${bad}]" "rc=0 OUT=[$(printf '%s\n' "$OUT" | tr '\n' ' ')]"; fi
  if chk_state '^tier=safe$' && [ "$(grep -c '^tier=' "$SB/state/state")" = "1" ]; then ok "tier.sh [${bad}]: state untouched"; else no "tier.sh [${bad}]: state untouched" "state: $(cat "$SB/state/state" 2>/dev/null)"; fi
  if [ -s "$SB/stderr" ]; then ok "tier.sh [${bad}]: says why on stderr"; else no "tier.sh [${bad}]: says why on stderr" "stderr empty"; fi
done
run_tier                       # no argv at all
if [ "$RC" -ne 0 ]; then ok "tier.sh: no argument refused"; else no "tier.sh: no argument refused" "rc=0"; fi
run_tier strict extra
if [ "$RC" -ne 0 ]; then ok "tier.sh: extra argument refused"; else no "tier.sh: extra argument refused" "rc=0"; fi
if chk_state '^tier=safe$' && [ "$(grep -c '^tier=' "$SB/state/state")" = "1" ]; then ok "tier.sh: every refused call wrote nothing"; else no "tier.sh: every refused call wrote nothing" "state: $(cat "$SB/state/state" 2>/dev/null)"; fi
if [ ! -s "$TEST_LOG" ]; then ok "tier.sh refused calls: no rule/filter commands"; else no "tier.sh refused calls: no rule/filter commands" "$(head -3 "$TEST_LOG")"; fi
cleanup_app_sandbox

# --- T3 case 4: an unusable state path is a failure, never a false success ---
# A regular file where the state directory belongs: mkdir, the temp write and the
# read-back all fail, so the exit code must not claim a write that never landed.
# (chmod on the state DIR cannot express this — ensure_state deliberately makes
# the owner of the state dir writable again.)
tier_sandbox
: > "$SB/not-a-dir"
OUT="$(env PATH="$SB/bin:$BASE_PATH" LGTVB_STATE_DIR="$SB/not-a-dir" \
  LGTVB_HOOK_DIR="$SB/hookdir" "$SH" "$SB/appdir/scripts/tier.sh" strict 2>"$SB/stderr")"
RC=$?
if [ "$RC" -ne 0 ]; then ok "tier.sh: unusable state path → non-zero exit"; else no "tier.sh: unusable state path → non-zero exit" "rc=0 (claimed a write that did not happen) OUT=[$(printf '%s\n' "$OUT" | tr '\n' ' ')]"; fi
if [ -s "$SB/stderr" ]; then ok "tier.sh: unusable state path names the failure"; else no "tier.sh: unusable state path names the failure" "stderr empty"; fi
if [ ! -s "$SB/not-a-dir" ]; then ok "tier.sh: unusable state path left untouched"; else no "tier.sh: unusable state path left untouched" "content: $(cat "$SB/not-a-dir")"; fi
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

# ==================== S4 review fixes (N2, N4) ====================

# --- S4 review N2: production default — no LGTVB_DNSQ override → dnsq.sh → node --
# Every other case pins LGTVB_DNSQ to the stub; this is the ONE case that runs the
# real branch selection (common.sh dnsq() → dnsq.sh → `exec node dnsq.js`), with
# the sandbox's stub node mirroring dnsq.js's output format + exit code. If the
# node branch were broken (fell through to nc), the stub-argv assert below and the
# dnsq.js-style output assert both fail — the case is not vacuous.
new_app_sandbox
OUT="$(env PATH="$SB/bin:$BASE_PATH" LGTVB_STATE_DIR="$SB/state" LGTVB_DNSQ= TEST_LOG="$TEST_LOG" \
  "$SH" "$SB/appdir/scripts/probe.sh" dnsq example.com 127.0.0.1 5335 2>&1)"
RC=$?
if [ "$RC" -eq 0 ] && printf '%s\n' "$OUT" | grep -q '^rcode=0 ancount=1 A='; then ok "dnsq node path: dnsq.js-style rcode output"; else no "dnsq node path: dnsq.js-style rcode output" "rc=$RC out=[$OUT]"; fi
if [ "$(printf '%s\n' "$OUT" | sed -n '$p')" = "rc=0" ]; then ok "dnsq node path: rc 0 passthrough"; else no "dnsq node path: rc 0 passthrough" "out=[$OUT]"; fi
if grep -q "node .*dnsq\.js example.com 127.0.0.1 5335" "$TEST_LOG"; then ok "dnsq node path: stub node invoked with dnsq.js args"; else no "dnsq node path: stub node invoked with dnsq.js args" "$(grep node "$TEST_LOG" 2>/dev/null | head -2)"; fi
cleanup_app_sandbox

# --- S4 review N4: LGTVB_CANARY_EVERY=0 must not break the keeper tick ----------
# run_bg pins the knob to 1; this inline launch sets 0, which pre-clamp made
# `$((tseq % CANARY_EVERY))` abort the script (division by 0 → keeper dead +
# stderr noise). Post-clamp the keeper ticks cleanly (modulo against default 6).
new_app_sandbox
printf 'upstream=192.168.179.1\ncap=dnat\npointer=on\n' > "$SB/state/state"
seed_rules 192.168.179.1
start_fake_filter
env PATH="$SB/bin:$BASE_PATH" \
  LGTVB_STATE_DIR="$SB/state" LGTVB_HOOK_DIR="$SB/hookdir" \
  LGTVB_DNSQ="$SB/bin/dnsq" LGTVB_FILTER_BIN="$SB/bin/fake-dnscrypt-proxy" \
  LGTVB_TICK=1 LGTVB_GUARD_TICK=1 LGTVB_BACKOFF=1 LGTVB_UWAIT_ROUNDS=2 LGTVB_UWAIT_SLEEP=1 \
  LGTVB_GUARD_GRACE=2 LGTVB_RULES_RETRY=3 LGTVB_RULES_RETRY_SLEEP=0 \
  LGTVB_TARGETS_FILE="$SB/targets" LGTVB_PROC_TCP="$SB/proc_tcp" LGTVB_CANARY_EVERY=0 \
  TEST_LOG="$TEST_LOG" TEST_IPT_STATE="$TEST_IPT_STATE" \
  TEST_DNSQ_NAME_RC="$TEST_DNSQ_NAME_RC" TEST_DNSQ_SERVER_RC="$TEST_DNSQ_SERVER_RC" \
  TEST_DNSQ_RC=0 \
  "$SH" "$SB/appdir/scripts/keeper.sh" >>"$SB/keeper-zero.out" 2>&1 </dev/null &
ZPID=$!
sleep 3.5
if kill -0 "$ZPID" 2>/dev/null && ! grep -Eq 'division|arithmetic' "$SB/keeper-zero.out"; then ok "CANARY_EVERY=0: keeper ticks clean (clamped)"; else no "CANARY_EVERY=0: keeper ticks clean (clamped)" "alive=$(kill -0 "$ZPID" 2>/dev/null && echo yes || echo no) out=[$(head -3 "$SB/keeper-zero.out" 2>/dev/null | tr '\n' ' ')]"; fi
if jrnl 'keeper-start' && ! jrnl 'keeper-filter-dead'; then ok "CANARY_EVERY=0: start logged, no spurious dead path"; else no "CANARY_EVERY=0: start logged, no spurious dead path" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
KEEPER_PID=$ZPID
stop_t4

# ==================== 0.4.2: keeper upstream-wait budget (Leg R fix) ====================
# Leg R (S4 T8) field finding: after an AP return, G1's WLAN rejoin took ~6-7 min
# (kernel scan cadence ~4 min), overshooting the old 12 x 10 s = 120 s budget, so the
# keeper hit terminal-giveup before the path returned. The shipped default is now
# 90 x 10 s = 15 min. The cases below pin BOTH ends: the old budget must still give
# up (non-vacuous baseline for the recovery case), the new default must recover.

write_late_luna_stub() {  # installs a self-flipping luna-send in this sandbox:
  # getStatus calls 1..LUNA_FAIL_CALLS report no usable dns1 (path down); from call
  # LUNA_FAIL_CALLS+1 on, a valid upstream. Call count lands in LUNA_COUNT_FILE.
  printf '%s\n' \
    '#!/bin/sh' \
    'c=$(cat "$LUNA_COUNT_FILE" 2>/dev/null || echo 0)' \
    'c=$((c+1))' \
    'printf "%s\n" "$c" > "$LUNA_COUNT_FILE"' \
    '[ -n "${TEST_LOG:-}" ] && echo "luna-send $*" >> "$TEST_LOG"' \
    'if [ "$c" -gt "$LUNA_FAIL_CALLS" ]; then cat "$LUNA_OK_FILE"; else cat "$LUNA_DOWN_FILE"; fi' \
    'exit 0' \
    > "$SB/bin/luna-send"
  chmod +x "$SB/bin/luna-send"
  printf '{"returnValue":true,"dns1":"","dns2":""}\n' > "$SB/luna-down.json"
  printf '{"returnValue":true,"dns1":"192.168.5.5","dns2":"192.168.9.1"}\n' > "$SB/luna-ok.json"
}

launch_upwait_keeper() {  # launch_upwait_keeper <rounds|default> <label>
  # Inline on purpose (run_bg pins LGTVB_UWAIT_ROUNDS=2): only the shipped default
  # or the explicit old-budget override may reach the keeper. UWAIT_SLEEP=1 keeps
  # the run fast; the budget is counted in rounds, so the sleep is timing-only.
  (
    export PATH="$SB/bin:$BASE_PATH" \
      LGTVB_STATE_DIR="$SB/state" LGTVB_HOOK_DIR="$SB/hookdir" \
      LGTVB_DNSQ="$SB/bin/dnsq" LGTVB_FILTER_BIN="$SB/bin/fake-dnscrypt-proxy" \
      LGTVB_TICK=1 LGTVB_GUARD_TICK=1 LGTVB_BACKOFF=1 LGTVB_UWAIT_SLEEP=1 LGTVB_GUARD_GRACE=2 \
      LGTVB_RULES_RETRY=3 LGTVB_RULES_RETRY_SLEEP=0 \
      LGTVB_TARGETS_FILE="$SB/targets" LGTVB_PROC_TCP="$SB/proc_tcp" LGTVB_CANARY_EVERY=1 \
      TEST_LOG="$TEST_LOG" TEST_IPT_STATE="$TEST_IPT_STATE" \
      TEST_DNSQ_NAME_RC="$TEST_DNSQ_NAME_RC" TEST_DNSQ_SERVER_RC="$TEST_DNSQ_SERVER_RC" \
      TEST_DNSQ_RC=0 \
      LUNA_COUNT_FILE="$SB/luna-count" LUNA_FAIL_CALLS=15 \
      LUNA_OK_FILE="$SB/luna-ok.json" LUNA_DOWN_FILE="$SB/luna-down.json"
    [ "$1" = "default" ] || export LGTVB_UWAIT_ROUNDS="$1"
    exec "$SH" "$SB/appdir/scripts/keeper.sh"
  ) >>"$SB/keeper-$2.out" 2>&1 </dev/null &
  KEEPER_PID=$!
}

upwait_setup() {  # fresh sandbox, path down + no filter → keeper enters the wait loop
  new_app_sandbox
  printf 'upstream=192.168.179.1\ncap=dnat\npointer=on\n' > "$SB/state/state"
  seed_rules 192.168.179.1
  blocked="$(grep -m1 '^=' "$SB/appdir/filter/filter-input.txt" | cut -c2-)"
  printf '%s 2\n' "$blocked" > "$TEST_DNSQ_NAME_RC"
  write_late_luna_stub
}

# --- direct default anchor (probe env carries no UWAIT override) ---------------
new_app_sandbox
OUT="$(probe_run uwait)"
if [ "$OUT" = "90 10" ]; then ok "upstream budget default: 90 rounds x 10 s = 15 min"; else no "upstream budget default: 90 rounds x 10 s = 15 min" "got [$OUT]"; fi
cleanup_app_sandbox

# --- same late-return scenario at the OLD budget: terminal give-up reproduced --
upwait_setup
launch_upwait_keeper 12 old
if wait_for "$SB/state/journal.log" 'terminal-giveup reason=upstream-wait-timeout' 300; then ok "upstream budget old(12): terminal give-up before the late return"; else no "upstream budget old(12): terminal give-up before the late return" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
lc="$(cat "$SB/luna-count" 2>/dev/null || echo 0)"
if [ "$lc" = "12" ]; then ok "upstream budget old(12): exactly 12 wait attempts (budget consumed)"; else no "upstream budget old(12): exactly 12 wait attempts (budget consumed)" "luna calls=$lc"; fi
if ! jrnl 'keeper-recovered'; then ok "upstream budget old(12): no recovery (late path never seen)"; else no "upstream budget old(12): no recovery (late path never seen)" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
if chk_state '^pointer=off$' && [ -f "$SB/state/gaveup" ]; then ok "upstream budget old(12): fail-open (pointer off + gaveup)"; else no "upstream budget old(12): fail-open (pointer off + gaveup)" "state: $(cat "$SB/state/state" 2>/dev/null)"; fi
stop_t4

# --- same late-return scenario at the SHIPPED default: recovers -----------------
# Non-vacuous: the luna stub yields an upstream only on call 16 (> the old 12),
# and the old-budget case above proves this scenario gave up before the fix.
upwait_setup
launch_upwait_keeper default new
if wait_for "$SB/state/journal.log" 'keeper-recovered' 400; then ok "upstream budget new(default): recovered after the late path return"; else no "upstream budget new(default): recovered after the late path return" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
lc="$(cat "$SB/luna-count" 2>/dev/null || echo 0)"
if [ "${lc:-0}" -ge 16 ] 2>/dev/null; then ok "upstream budget new(default): waited past the old 12-round budget (calls=$lc)"; else no "upstream budget new(default): waited past the old 12-round budget (calls=$lc)" "luna calls=$lc"; fi
if ! jrnl 'terminal-giveup'; then ok "upstream budget new(default): no terminal give-up"; else no "upstream budget new(default): no terminal give-up" "$(grep terminal-giveup "$SB/state/journal.log")"; fi
if chk_state '^upstream=192\.168\.5\.5$' && chk_state '^pointer=on$' && [ ! -e "$SB/state/gaveup" ]; then ok "upstream budget new(default): converged (new upstream, pointer on, no gaveup)"; else no "upstream budget new(default): converged (new upstream, pointer on, no gaveup)" "state: $(cat "$SB/state/state" 2>/dev/null)"; fi
run_app check.sh
if printf '%s\n' "$OUT" | grep -q '^mode=on$'; then ok "upstream budget new(default): check.sh mode=on"; else no "upstream budget new(default): check.sh mode=on" "OUT: $(printf '%s\n' "$OUT" | tr '\n' ' ')"; fi
stop_t4

# ==================== S6b T5: the overrides writer ============================
# overrides.sh is the UI's only write path into the override state: the bridge
# pipes one payload into `save` (src/bridge.ts holds the command strings, and
# the payload has exactly that one entry path). It stores the DIFFERENCE against
# the active tier's preset, resolved by the SAME helper materialize uses — never
# read back from the materialized $STATE/filter-input.txt — so a change saved but
# not yet applied still reads back as saved, an upstream list that grew an entry
# is never fought by a stale diff, and a stale materialized file can never become
# the baseline.
#
# A fresh sandbox ships only filter-input.txt, i.e. the legacy fallback, which IS
# the strict list (all shipped domains.json rows are in it); tier_sandbox adds the
# real per-tier presets for the cases that need the SAFE/STRICT difference.
ov_run() {  # ov_run <args...>; stdin = $OV_PAYLOAD (empty when unset); sets OUT + RC
  OUT="$(printf '%s' "${OV_PAYLOAD-}" | env PATH="$SB/bin:$BASE_PATH" \
    LGTVB_STATE_DIR="$SB/state" LGTVB_HOOK_DIR="$SB/hookdir" \
    "$SH" "$SB/appdir/scripts/overrides.sh" "$@" 2>"$SB/stderr")"
  RC=$?
  OV_PAYLOAD=""
}
ov_names() {  # the domains.json rows, in file order
  sed -n 's/^[[:space:]]*"name": "\([a-z0-9._-]\{1,\}\)",$/\1/p' "$SB/appdir/filter/domains.json"
}
ov_rep() {  # ov_rep <char> <n>
  awk -v c="$1" -v n="$2" 'BEGIN { for (i = 0; i < n; i++) printf "%s", c }'
}
ov_no_state() {  # nothing stored, no scratch file left behind
  if [ ! -e "$SB/state/overrides.txt" ] && [ -z "$(find "$SB/state" -maxdepth 1 -name 'overrides.*' 2>/dev/null)" ]; then
    ok "$1"
  else
    no "$1" "$SB/state now holds: $(find "$SB/state" -maxdepth 1 -type f 2>/dev/null | tr '\n' ' ')"
  fi
}
ov_no_tmp() {  # no scratch file left behind
  if [ -z "$(find "$SB/state" -maxdepth 1 -name 'overrides.*.tmp' 2>/dev/null)" ]; then
    ok "$1"
  else
    no "$1" "$(find "$SB/state" -maxdepth 1 -type f 2>/dev/null | tr '\n' ' ')"
  fi
}
ov_reject_case() {  # ov_reject_case <label> <payload> <reason>
  OV_PAYLOAD=$2
  ov_run save
  OV_PAYLOAD=""
  if [ "$RC" -ne 2 ]; then
    no "save rejects $1" "rc=$RC out=[$(printf '%s\n' "$OUT" | tr '\n' ' ')]"
    return
  fi
  if jrnl "overrides-reject reason=$3"; then
    ok "save rejects $1 (reason=$3)"
  else
    no "save rejects $1 (reason=$3)" "$(tail -2 "$SB/state/journal.log" 2>/dev/null | tr '\n' ' ')"
  fi
  # S6b T7/T8 enablement: the machine-readable refusal the UI parses. -x demands
  # the token be a line of its own with exactly this text, and the count must be
  # 1: deleting the token, changing its spelling, echoing user data into it, or
  # adding a second one all turn this into a FAIL (the counterfactual is the
  # implementation two lines up in ov_reject).
  ov_tok_n="$(grep -c '^OVERRIDES-REJECT' "$SB/stderr" 2>/dev/null || true)"
  if [ "${ov_tok_n:-0}" = "1" ] && grep -qx "OVERRIDES-REJECT reason=$3" "$SB/stderr" 2>/dev/null; then
    ok "save rejects $1 (one UI token, reason=$3)"
  else
    no "save rejects $1 (one UI token, reason=$3)" "count=${ov_tok_n:-0} stderr=[$(cat "$SB/stderr" 2>/dev/null | tr '\n' ' ')]"
  fi
  # ...and the human prose line is still there, unchanged.
  if grep -q '^overrides.sh: ' "$SB/stderr" 2>/dev/null; then
    ok "save rejects $1 (human prose kept)"
  else
    no "save rejects $1 (human prose kept)" "stderr=[$(cat "$SB/stderr" 2>/dev/null | tr '\n' ' ')]"
  fi
}

# --- T5 case 1: `list` with no overrides = the preset, dense, in file order ----
new_app_sandbox
ov_run list
if [ "$RC" -eq 0 ]; then ok "list: rc 0 with no overrides"; else no "list: rc 0 with no overrides" "rc=$RC out=[$(printf '%s\n' "$OUT" | tr '\n' ' ')] err=[$(cat "$SB/stderr" 2>/dev/null)]"; fi
want="$(ov_names | sed 's/$/=on/')"
if [ "$OUT" = "$want" ]; then ok "list: one line per domains.json row, in file order, all on for the preset ($(ov_names | grep -c .))"; else no "list: one line per domains.json row, in file order" "got [$(printf '%s\n' "$OUT" | sed -n '1p;$p' | tr '\n' ' ')] want [$(printf '%s\n' "$want" | sed -n '1p;$p' | tr '\n' ' ')]"; fi
badlines="$(printf '%s\n' "$OUT" | grep -vc '^[a-z0-9._-]\{1,128\}=\(on\|off\)$' || true)"
if [ "$badlines" = "0" ]; then ok "list: pure data (every line name=on|off, no header or RESULT block)"; else no "list: pure data" "$badlines line(s) off-grammar"; fi
if [ ! -e "$SB/state/overrides.txt" ]; then ok "list: writes no state"; else no "list: writes no state" "$(cat "$SB/state/overrides.txt")"; fi
if jrnl 'overrides-fallback reason=no-tier-file tier=safe'; then ok "list: uses the shared tier resolver (legacy fallback, tagged for the overrides reader)"; else no "list: uses the shared tier resolver" "$(cat "$SB/state/journal.log" 2>/dev/null)"; fi
ov_no_tmp "list: no scratch file left behind"
cleanup_app_sandbox

# --- T5 case 2: the preset is the ACTIVE TIER's list --------------------------
# 20 safe rows + 8 zone anchors live in the strict presets only; everything else
# is a strict-only row. A list built from the wrong preset would show them wrong.
tier_sandbox
printf 'tier=safe\n' > "$SB/state/state"
ov_run list
if [ "$RC" -eq 0 ]; then ok "list (safe tier): rc 0"; else no "list (safe tier): rc 0" "rc=$RC"; fi
want="$(ov_names | while IFS= read -r n; do if grep -F -x -q "=$n" "$SB/appdir/filter/filter-input-safe.txt"; then printf '%s=on\n' "$n"; else printf '%s=off\n' "$n"; fi; done)"
if [ "$OUT" = "$want" ]; then ok "list (safe tier): every row matches the SAFE preset"; else
  printf '%s\n' "$OUT" > "$SB/ov-actual.txt"; printf '%s\n' "$want" > "$SB/ov-want.txt"
  no "list (safe tier): every row matches the SAFE preset" "$(diff "$SB/ov-actual.txt" "$SB/ov-want.txt" 2>&1 | head -4 | tr '\n' ' ')"
fi
if [ "$(printf '%s\n' "$OUT" | grep -c '=on$' || true)" = "$(grep -c '^=' "$SB/appdir/filter/filter-input-safe.txt")" ]; then ok "list (safe tier): exactly the shipped safe rows read on"; else no "list (safe tier): exactly the shipped safe rows read on" "on=$(printf '%s\n' "$OUT" | grep -c '=on$' || true) safe=$(grep -c '^=' "$SB/appdir/filter/filter-input-safe.txt")"; fi
za_ok=1; za_bad=""
# shellcheck disable=SC2013  # a domain list is one token per line by construction (no whitespace in a name)
for z in $(grep '^[a-z]' "$SB/appdir/filter/filter-input-strict.txt"); do
  printf '%s\n' "$OUT" | grep -qx "$z=off" || { za_ok=0; za_bad="$z"; break; }
done
if [ "$za_ok" = "1" ]; then ok "list (safe tier): the strict-only zone anchors read off (the safe preset ships no bare anchor)"; else no "list (safe tier): zone anchors read off" "$za_bad is not off"; fi
printf 'tier=strict\n' > "$SB/state/state"
ov_run list
if [ "$OUT" = "$(ov_names | sed 's/$/=on/')" ]; then ok "list (strict tier): every row on, from the strict preset"; else no "list (strict tier): every row on" "$(printf '%s\n' "$OUT" | grep -c '=off$' || true) rows off"; fi
cleanup_app_sandbox

# --- T5 case 3: `save` stores the diff only, and materialize agrees ------------
new_app_sandbox
ov_off="$(ov_names | while IFS= read -r n; do grep -F -x -q "=$n" "$SB/appdir/filter/filter-input.txt" && { printf '%s\n' "$n"; break; }; done)"
OV_PAYLOAD="$ov_off=off"
ov_run save
if [ "$RC" -eq 0 ]; then ok "save: rc 0"; else no "save: rc 0" "rc=$RC out=[$(printf '%s\n' "$OUT" | tr '\n' ' ')] err=[$(cat "$SB/stderr" 2>/dev/null)]"; fi
if [ "$(printf '%s\n' "$OUT" | sed -n '1p')" = "RESULT=overrides" ] && [ "$(printf '%s\n' "$OUT" | sed -n '2p')" = "reason=saved" ]; then ok "save: machine-readable result (RESULT=overrides reason=saved)"; else no "save: machine-readable result" "[$(printf '%s\n' "$OUT" | tr '\n' ' ')]"; fi
if [ "$(cat "$SB/state/overrides.txt" 2>/dev/null)" = "-$ov_off" ]; then ok "save: stores one diff line for one changed row (out of $(ov_names | grep -c .))"; else no "save: stores one diff line for one changed row" "[$(cat "$SB/state/overrides.txt" 2>/dev/null)]"; fi
if [ -n "$(find "$SB/state" -maxdepth 1 -name overrides.txt -perm 600 2>/dev/null)" ]; then ok "save: overrides.txt is root-only (0600)"; else no "save: overrides.txt is root-only (0600)" "$(find "$SB/state" -maxdepth 1 -type f 2>/dev/null | tr '\n' ' ') mode=$(find "$SB/state" -maxdepth 1 -name overrides.txt -exec ls -l {} + 2>/dev/null | cut -c1-10)"; fi
if jrnl 'overrides-save lines=1'; then ok "save: journal records the stored diff size"; else no "save: journal records the stored diff size" "$(tail -1 "$SB/state/journal.log" 2>/dev/null)"; fi
if [ ! -e "$SB/state/filter-input.txt" ]; then ok "save: touches no filter input (making it effective stays the apply path)"; else no "save: touches no filter input" "filter input present"; fi
ov_run list
if printf '%s\n' "$OUT" | grep -qx "$ov_off=off"; then ok "list: the saved row reads off before any apply"; else no "list: the saved row reads off before any apply" "$(printf '%s\n' "$OUT" | grep -x ".*$ov_off.*" || true)"; fi
if [ "$(printf '%s\n' "$OUT" | grep -c '=on$' || true)" = "$(( $(ov_names | grep -c .) - 1 ))" ]; then ok "list: every other row is untouched"; else no "list: every other row is untouched" "on=$(printf '%s\n' "$OUT" | grep -c '=on$' || true)"; fi
ov_no_tmp "save: no scratch file left behind"
probe_run materialize 192.168.5.5 >/dev/null
if grep -qx "=$ov_off" "$SB/state/filter-input.txt"; then no "materialize: the stored '-' removes the exact rule" "still present"; else ok "materialize: the stored '-' removes the exact rule"; fi
if [ "$(grep -c . "$SB/state/filter-input.txt")" = "$(( $(grep -c . "$SB/appdir/filter/filter-input.txt") - 1 ))" ]; then ok "materialize: exactly one entry fewer than the preset"; else no "materialize: exactly one entry fewer than the preset" "$(grep -c . "$SB/state/filter-input.txt")/$(grep -c . "$SB/appdir/filter/filter-input.txt")"; fi
# The whole chain agrees row by row: `list` (preset+overrides) == materialize.
LIST_OUT="$OUT"; mm=""
for n in $(ov_names); do
  if printf '%s\n' "$LIST_OUT" | grep -qx "$n=on"; then
    grep -F -x -q -e "=$n" -e "$n" "$SB/state/filter-input.txt" || mm="$n(list=on)"
  else
    grep -F -x -q -e "=$n" -e "$n" "$SB/state/filter-input.txt" && mm="$n(list=off)"
  fi
  [ -n "$mm" ] && break
done
if [ -z "$mm" ]; then ok "list and the materialized list agree on all $(ov_names | grep -c .) rows"; else no "list and the materialized list agree on all rows" "$mm"; fi
cleanup_app_sandbox

# --- T5 case 4: a diff is a diff — the preset is always the baseline ----------
tier_sandbox
printf 'tier=safe\n' > "$SB/state/state"
ov_new="$(ov_names | while IFS= read -r n; do grep -F -x -q "=$n" "$SB/appdir/filter/filter-input-strict.txt" && ! grep -F -x -q "=$n" "$SB/appdir/filter/filter-input-safe.txt" && { printf '%s\n' "$n"; break; }; done)"
OV_PAYLOAD="$ov_new=on"
ov_run save
if [ "$(cat "$SB/state/overrides.txt" 2>/dev/null)" = "+$ov_new" ]; then ok "save (safe tier): '+' is the diff against the SAFE preset, not the legacy list"; else no "save (safe tier): '+' is the diff against the SAFE preset" "[$(cat "$SB/state/overrides.txt" 2>/dev/null)]"; fi
# An entry the preset gains later must win: the stored line is a difference, not a
# copy of the state, so no `-` line can hold a new preset row off.
ov_extra="$(ov_names | while IFS= read -r n; do [ "$n" = "$ov_new" ] && continue; ! grep -F -x -q "=$n" "$SB/appdir/filter/filter-input-safe.txt" && { printf '%s\n' "$n"; break; }; done)"
printf '=%s\n' "$ov_extra" >> "$SB/appdir/filter/filter-input-safe.txt"
ov_run list
if printf '%s\n' "$OUT" | grep -qx "$ov_extra=on"; then ok "list: a row the preset gained afterwards reads on (no stale '- ' can hold it off)"; else no "list: a row the preset gained afterwards reads on" "$(printf '%s\n' "$OUT" | grep -x "$ov_extra=.*" || true)"; fi
if printf '%s\n' "$OUT" | grep -qx "$ov_new=on"; then ok "list: the saved '+' row still reads on"; else no "list: the saved '+' row still reads on" "$(printf '%s\n' "$OUT" | grep -x "$ov_new=.*" || true)"; fi
probe_run materialize 192.168.5.5 >/dev/null
if grep -qx "=$ov_extra" "$SB/state/filter-input.txt" && grep -qx "=$ov_new" "$SB/state/filter-input.txt"; then ok "materialize: both the saved row and the new preset row are blocked"; else no "materialize: both the saved row and the new preset row are blocked" "$(grep -c . "$SB/state/filter-input.txt") entries"; fi
cleanup_app_sandbox

# --- T5 case 5: an empty diff is the ABSENCE of the file ----------------------
new_app_sandbox
ov_off="$(ov_names | while IFS= read -r n; do grep -F -x -q "=$n" "$SB/appdir/filter/filter-input.txt" && { printf '%s\n' "$n"; break; }; done)"
OV_PAYLOAD="$ov_off=off"
ov_run save
if [ -f "$SB/state/overrides.txt" ]; then ok "save: a real change writes the file"; else no "save: a real change writes the file" "rc=$RC"; fi
OV_PAYLOAD="$ov_off=on"
ov_run save
if [ "$RC" -eq 0 ] && [ "$(printf '%s\n' "$OUT" | sed -n '2p')" = "reason=cleared" ]; then ok "save: turning the last change back reports reason=cleared"; else no "save: turning the last change back reports reason=cleared" "rc=$RC [$(printf '%s\n' "$OUT" | tr '\n' ' ')]"; fi
if [ ! -e "$SB/state/overrides.txt" ]; then ok "save: an empty diff removes the file (the preset is authoritative again)"; else no "save: an empty diff removes the file" "[$(cat "$SB/state/overrides.txt" 2>/dev/null)]"; fi
if jrnl 'overrides-save lines=0 cleared=1'; then ok "save: journal records the clear"; else no "save: journal records the clear" "$(tail -2 "$SB/state/journal.log" 2>/dev/null | tr '\n' ' ')"; fi
ov_no_state "save (no-op): a payload that changes nothing leaves no state behind"
OV_PAYLOAD="$ov_off=on"
ov_run save
if [ "$RC" -eq 0 ] && [ ! -e "$SB/state/overrides.txt" ]; then ok "save: a no-op payload is rc 0 with no file created"; else no "save: a no-op payload is rc 0 with no file created" "rc=$RC"; fi
cleanup_app_sandbox

# --- T5 case 6: a rejected payload writes nothing ------------------------------
new_app_sandbox
# The writer re-validates every line (D13a): what it would have to guess at is
# refused wholesale, exit 2, journaled, with the state file left byte-identical —
# the read side (overrides_apply) stays tolerant of a hand-edited file, the write
# side never creates one.
ov_off="$(ov_names | while IFS= read -r n; do grep -F -x -q "=$n" "$SB/appdir/filter/filter-input.txt" && { printf '%s\n' "$n"; break; }; done)"
OV_PAYLOAD="$ov_off=off"
ov_run save
saved_ok="$(cat "$SB/state/overrides.txt" 2>/dev/null)"
if [ "$saved_ok" = "-$ov_off" ]; then ok "save: a valid payload stores state for the rejections to leave alone"; else no "save: a valid payload stores state" "[$saved_ok] rc=$RC"; fi
# shellcheck disable=SC2016  # literal payload text, not expressions: the writer has to refuse these as characters
for badname in 'UPPER.example' 'bad name' 'bad;name' 'bad$name' 'bad*name' 'bad\name' "bad'name" 'bad"name' 'bad(name' 'bad`name' 'bad|name' 'bad&name' 'bad#name' 'bad!name' ',name' ':name' 'name,name' '+badname' '$(id)' '`id`'; do
  ov_reject_case "the name [$badname]" "$badname=off" bad-charset
done
ov_no_tmp "save (bad-charset batch): no scratch file left behind"
if [ "$(cat "$SB/state/overrides.txt" 2>/dev/null)" = "$saved_ok" ]; then ok "save (bad-charset batch): the stored state is untouched"; else no "save (bad-charset batch): the stored state is untouched" "[$(cat "$SB/state/overrides.txt" 2>/dev/null)]"; fi
ov_reject_case "a line without '='" 'just-a-name' bad-shape
ov_reject_case "a state that is not on/off" 'example.com=maybe' bad-shape
ov_reject_case "an empty name" '=off' bad-shape
ov_reject_case "an empty state" "$ov_off=" bad-shape
ov_reject_case "a CR-terminated line" "$(printf 'ad.lgappstv.com=off\r')" bad-shape
ov_reject_case "a name that is not in domains.json" 'not-a-domain.example=off' unknown-domain
ov_reject_case "an unknown domain the reader could still add" 'forced.example=off' unknown-domain
ov_reject_case "a name longer than 128 characters" "$(ov_rep a 129)=off" name-too-long
ov_reject_case "the same name twice" "$ov_off=on
$ov_off=off" duplicate
ov_reject_case "more than 512 lines" "$(awk 'BEGIN { for (i = 0; i < 600; i++) print "x" }')" oversized
ov_reject_case "more than 16384 bytes" "$(ov_rep a 20000)" oversized
ov_reject_case "an empty payload" '' empty-payload
ov_reject_case "blank lines only" '

' empty-payload
if [ "$(cat "$SB/state/overrides.txt" 2>/dev/null)" = "$saved_ok" ]; then ok "save (rejections): the stored state survives every rejection"; else no "save (rejections): the stored state survives every rejection" "[$(cat "$SB/state/overrides.txt" 2>/dev/null)]"; fi
ov_no_tmp "save (rejections): no scratch file left behind"
cleanup_app_sandbox

# --- T5 case 7: usage, and the payload has exactly one entry path ------------
new_app_sandbox
ov_run
if [ "$RC" -eq 2 ] && jrnl 'overrides-reject reason=bad-usage'; then ok "usage: no argument is refused (rc 2, journaled)"; else no "usage: no argument is refused" "rc=$RC [$(printf '%s\n' "$OUT" | tr '\n' ' ')]"; fi
ov_run save extra
if [ "$RC" -eq 2 ] && jrnl 'overrides-reject reason=bad-usage'; then ok "usage: a second argument is refused"; else no "usage: a second argument is refused" "rc=$RC"; fi
ov_run bogus
if [ "$RC" -eq 2 ] && jrnl 'overrides-reject reason=bad-usage'; then ok "usage: an unknown command is refused"; else no "usage: an unknown command is refused" "rc=$RC"; fi
ov_run "$(ov_names | sed -n '1p')=off"
if [ "$RC" -eq 2 ]; then ok "usage: a payload-shaped argument is refused (save reads stdin only)"; else no "usage: a payload-shaped argument is refused" "rc=$RC [$(printf '%s\n' "$OUT" | tr '\n' ' ')]"; fi
ov_no_state "usage: nothing written"
cleanup_app_sandbox

# --- T5 case 8: clear is the way back ----------------------------------------
new_app_sandbox
ov_run clear
if [ "$RC" -eq 0 ] && [ "$(printf '%s\n' "$OUT" | sed -n '1p')" = "RESULT=overrides" ] && [ "$(printf '%s\n' "$OUT" | sed -n '2p')" = "reason=cleared" ]; then ok "clear: rc 0 with nothing to clear (idempotent, machine-readable)"; else no "clear: rc 0 with nothing to clear" "rc=$RC [$(printf '%s\n' "$OUT" | tr '\n' ' ')]"; fi
ov_off="$(ov_names | sed -n '1p')"
OV_PAYLOAD="$ov_off=off"
ov_run save
ov_run clear
if [ "$RC" -eq 0 ] && [ ! -e "$SB/state/overrides.txt" ]; then ok "clear: removes the stored diff"; else no "clear: removes the stored diff" "rc=$RC [$(find "$SB/state" -maxdepth 1 -type f 2>/dev/null | tr '\n' ' ')]"; fi
if jrnl 'overrides-clear'; then ok "clear: journaled"; else no "clear: journaled" "$(tail -2 "$SB/state/journal.log" 2>/dev/null | tr '\n' ' ')"; fi
ov_run clear
if [ "$RC" -eq 0 ] && [ ! -e "$SB/state/overrides.txt" ]; then ok "clear: idempotent"; else no "clear: idempotent" "rc=$RC"; fi
ov_run list
if printf '%s\n' "$OUT" | grep -qx "$ov_off=on"; then ok "clear: the cleared row reads on again"; else no "clear: the cleared row reads on again" "$(printf '%s\n' "$OUT" | grep -x "$ov_off=.*" || true)"; fi
cleanup_app_sandbox

# --- T5 case 9: a damaged install is refused, clear still works ----------------
new_app_sandbox
cp "$FILTER_SRC/filter-input-strict.txt" "$SB/appdir/filter/filter-input-strict.txt"
ov_run list
if [ "$RC" -eq 1 ]; then ok "list: refuses on a partial install (one tier file, rc 1)"; else no "list: refuses on a partial install" "rc=$RC [$(printf '%s\n' "$OUT" | tr '\n' ' ')]"; fi
if jrnl 'overrides-fail reason=partial-tier-files tier=safe' && jrnl 'overrides-fail reason=no-preset'; then ok "list: journaled under the overrides tag (partial install, then the refusal)"; else no "list: journaled under the overrides tag" "$(tail -2 "$SB/state/journal.log" 2>/dev/null | tr '\n' ' ')"; fi
OV_PAYLOAD="$(ov_names | sed -n '1p')=off"
ov_run save
if [ "$RC" -eq 1 ] && [ ! -e "$SB/state/overrides.txt" ]; then ok "save: refuses on a partial install, writes nothing"; else no "save: refuses on a partial install" "rc=$RC [$(find "$SB/state" -maxdepth 1 -type f 2>/dev/null | tr '\n' ' ')]"; fi
ov_run clear
if [ "$RC" -eq 0 ]; then ok "clear: still works on a damaged install (the way back to the preset)"; else no "clear: still works on a damaged install" "rc=$RC"; fi
rm -f "$SB/appdir/filter/filter-input-strict.txt" "$SB/appdir/filter/domains.json"
ov_run list
if [ "$RC" -eq 1 ] && jrnl 'overrides-fail reason=no-domains'; then ok "list: refuses without domains.json (rc 1, journaled)"; else no "list: refuses without domains.json" "rc=$RC"; fi
OV_PAYLOAD='anything=off'
ov_run save
if [ "$RC" -eq 1 ] && [ ! -e "$SB/state/overrides.txt" ]; then ok "save: refuses without domains.json, writes nothing"; else no "save: refuses without domains.json" "rc=$RC"; fi
ov_run clear
if [ "$RC" -eq 0 ]; then ok "clear: works with no preset and no domains.json"; else no "clear: works with no preset and no domains.json" "rc=$RC"; fi
if [ -z "$(find "$SB/state" -maxdepth 1 -name 'overrides.*.tmp' 2>/dev/null)" ]; then ok "damaged install: no scratch file left behind"; else no "damaged install: no scratch file left behind" "$(find "$SB/state" -maxdepth 1 -type f 2>/dev/null | tr '\n' ' ')"; fi
cleanup_app_sandbox

# --- T5 case 10: one length bound, shared with the reader ----------------------
new_app_sandbox
ov_128="$(ov_rep a 128)"
ov_129="$(ov_rep a 129)"
printf '+%s\n+%s\n' "$ov_129" "$ov_128" > "$SB/state/overrides.txt"
probe_run materialize 192.168.5.5 >/dev/null
if grep -qx "=$ov_128" "$SB/state/filter-input.txt"; then ok "reader: a 128-char name is applied (the reader and the writer share the bound)"; else no "reader: a 128-char name is applied" "$(grep -c . "$SB/state/filter-input.txt") entries"; fi
if grep -qx "=$ov_129" "$SB/state/filter-input.txt"; then no "reader: a 129-char name is ignored" "applied"; else ok "reader: a 129-char name is ignored"; fi
ov_reject_case "a 129-char name" "$ov_129=off" name-too-long
if [ "$(cat "$SB/state/overrides.txt" 2>/dev/null)" = "$(printf '+%s\n+%s' "$ov_129" "$ov_128")" ]; then ok "save: a hand-edited file is left byte-identical by a rejection"; else no "save: a hand-edited file is left byte-identical by a rejection" "[$(tr '\n' ' ' < "$SB/state/overrides.txt" 2>/dev/null)]"; fi
ov_no_tmp "bounds: no scratch file left behind"
cleanup_app_sandbox

# --- T5 case 11: one mv installs the diff, nothing scratch survives ------------
new_app_sandbox
ov_off="$(ov_names | while IFS= read -r n; do grep -F -x -q "=$n" "$SB/appdir/filter/filter-input.txt" && { printf '%s\n' "$n"; break; }; done)"
ov_off2="$(ov_names | while IFS= read -r n; do grep -F -x -q "=$n" "$SB/appdir/filter/filter-input.txt" && [ "$n" != "$ov_off" ] && { printf '%s\n' "$n"; break; }; done)"
OV_PAYLOAD="$ov_off=off"
ov_run save
# The previous file gets a second name (a hard link) before the next save: if the
# diff were rewritten in place, this name would show the new content too. It must
# not — the stored state is installed with one rename, never edited in place.
ln "$SB/state/overrides.txt" "$SB/state/ov-link.txt"
OV_PAYLOAD="$ov_off2=off"
ov_run save
if [ "$(cat "$SB/state/ov-link.txt" 2>/dev/null)" = "-$ov_off" ] && [ "$(cat "$SB/state/overrides.txt" 2>/dev/null)" != "-$ov_off" ]; then ok "save: installs the diff by rename (the old file kept its content under its other name)"; else no "save: installs the diff by rename" "old=[$(cat "$SB/state/ov-link.txt" 2>/dev/null)] new=[$(cat "$SB/state/overrides.txt" 2>/dev/null)]"; fi
rm -f "$SB/state/ov-link.txt"
if [ "$(cat "$SB/state/overrides.txt" 2>/dev/null)" = "$(printf -- '-%s\n-%s\n' "$ov_off" "$ov_off2" | sort)" ]; then ok "save: two changes store two sorted diff lines"; else no "save: two changes store two sorted diff lines" "[$(tr '\n' ' ' < "$SB/state/overrides.txt" 2>/dev/null)]"; fi
ov_no_tmp "save: no scratch file left behind after two saves"
ov_reject_case "a bad name after two saves" 'bad name=off' bad-charset
ov_no_tmp "save (rejected): no scratch file left behind"
if [ -n "$(find "$SB/state" -maxdepth 1 -name overrides.txt -perm 600 2>/dev/null)" ]; then ok "save: 0600 survives the second write"; else no "save: 0600 survives the second write" "$(find "$SB/state" -maxdepth 1 -name overrides.txt -exec ls -l {} + 2>/dev/null | cut -c1-10)"; fi
cleanup_app_sandbox

# --- T5 case 12: the materialized input is never the baseline ------------------
new_app_sandbox
probe_run materialize 192.168.5.5 >/dev/null
ov_off="$(ov_names | sed -n '1p')"
printf '=stale.example.invalid\n' >> "$SB/state/filter-input.txt"
ov_run list
if [ "$OUT" = "$(ov_names | sed 's/$/=on/')" ]; then ok "list: ignores a stale/hand-edited state/filter-input.txt"; else no "list: ignores a stale/hand-edited filter input" "$(printf '%s\n' "$OUT" | grep -c '=off$' || true) rows off"; fi
OV_PAYLOAD="$ov_off=off"
ov_run save
if grep -qx "=$ov_off" "$SB/state/filter-input.txt"; then ok "save: does not apply itself (making it effective stays the separate apply path)"; else no "save: does not apply itself" "already removed"; fi
ov_run list
if printf '%s\n' "$OUT" | grep -qx "$ov_off=off"; then ok "list: a saved but not yet applied change reads back as saved"; else no "list: a saved but not yet applied change reads back as saved" "$(printf '%s\n' "$OUT" | grep -x "$ov_off=.*" || true)"; fi
ov_no_tmp "stale input: no scratch file left behind"
cleanup_app_sandbox

# --- T5 case 13: a zone row is a diff too (anchors come back) -----------------
tier_sandbox
printf 'tier=strict\n' > "$SB/state/state"
ov_zone="$(grep -m1 '^[a-z]' "$SB/appdir/filter/filter-input-strict.txt")"
ov_base="$(grep -c . "$SB/appdir/filter/filter-input-strict.txt")"
OV_PAYLOAD="$ov_zone=off"
ov_run save
if [ "$(cat "$SB/state/overrides.txt" 2>/dev/null)" = "-$ov_zone" ]; then ok "save (zone row off): one diff line against the strict preset"; else no "save (zone row off): one diff line" "[$(tr '\n' ' ' < "$SB/state/overrides.txt" 2>/dev/null)]"; fi
probe_run materialize 192.168.5.5 >/dev/null
if ! grep -qx "$ov_zone" "$SB/state/filter-input.txt" && ! grep -qx "=$ov_zone" "$SB/state/filter-input.txt"; then ok "materialize: the zone row off removes the whole zone (exact rule and bare anchor)"; else no "materialize: the zone row off removes the whole zone" "$(grep -c "$ov_zone" "$SB/state/filter-input.txt")"; fi
if [ "$(grep -c . "$SB/state/filter-input.txt")" = "$((ov_base - 2))" ]; then ok "materialize: one zone anchor is two preset lines"; else no "materialize: one zone anchor is two preset lines" "$(grep -c . "$SB/state/filter-input.txt")/$ov_base"; fi
OV_PAYLOAD="$ov_zone=on"
ov_run save
if [ "$RC" -eq 0 ] && [ ! -e "$SB/state/overrides.txt" ]; then ok "save (zone row back on): the diff empties, so no stored line can lose the anchor"; else no "save (zone row back on): the diff empties" "rc=$RC [$(tr '\n' ' ' < "$SB/state/overrides.txt" 2>/dev/null)]"; fi
probe_run materialize 192.168.5.5 >/dev/null
if grep -qx "$ov_zone" "$SB/state/filter-input.txt" && grep -qx "=$ov_zone" "$SB/state/filter-input.txt" && [ "$(grep -c . "$SB/state/filter-input.txt")" = "$ov_base" ]; then ok "materialize: the preset is back verbatim ($ov_base entries, both lines of $ov_zone)"; else no "materialize: the preset is back verbatim" "$(grep -c . "$SB/state/filter-input.txt")/$ov_base entries"; fi
cleanup_app_sandbox

# --- T5 case 14 (review F1a/F2): reject-last is a property of EVERY preset -----
# The refusal is not "does the ACTIVE list still have entries". The stored diff is
# a diff against whatever tier is active, so a tier switch re-baselines it: under
# STRICT, turning the 20 SAFE rows off leaves 95 of 115 exact rules (plus 8
# anchors) — a diff the old active-only check accepted without a word — but
# `tier.sh safe` would then materialize the SAFE preset minus those rows, i.e. a
# comment-only list, and the panel would report protection while nothing was
# blocked. save therefore asks the question of every shipped preset and refuses
# with the one that would be emptied (journal: tier=<t>).
tier_sandbox
printf 'tier=strict\n' > "$SB/state/state"
# The SAFE rows, derived from the shipped SAFE preset (never hardcoded): exactly
# the rows a SAFE-tier install blocks, and the set that empties it when removed.
ov_names | while IFS= read -r n; do grep -F -x -q "=$n" "$SB/appdir/filter/filter-input-safe.txt" && printf '%s\n' "$n"; done > "$SB/ov-safe-rows.txt"
ov_safe_n=$(grep -c . "$SB/ov-safe-rows.txt" | tr -d ' ')
if [ "$ov_safe_n" = "$(grep -c '^=' "$SB/appdir/filter/filter-input-safe.txt" | tr -d ' ')" ] && [ "$ov_safe_n" -gt 0 ]; then
  ok "cross-tier: the SAFE rows are exactly the rows the SAFE preset blocks ($ov_safe_n)"
else
  no "cross-tier: the SAFE rows are exactly the rows the SAFE preset blocks" "rows=$ov_safe_n safe=$(grep -c '^=' "$SB/appdir/filter/filter-input-safe.txt")"
fi
ov_only="$(ov_names | grep -F -x -v -f "$SB/ov-safe-rows.txt" | sed -n '1p')"
OV_PAYLOAD="$ov_only=off"
ov_run save
if [ "$RC" -eq 0 ] && [ "$(cat "$SB/state/overrides.txt" 2>/dev/null)" = "-$ov_only" ]; then ok "cross-tier: a diff that survives every preset is still saved (no over-rejection)"; else no "cross-tier: a diff that survives every preset is still saved" "rc=$RC [$(tr '\n' ' ' < "$SB/state/overrides.txt" 2>/dev/null)]"; fi
cp "$SB/state/overrides.txt" "$SB/ov-keep.txt"
OV_PAYLOAD="$(sed 's/$/=off/' "$SB/ov-safe-rows.txt")"
ov_run save
if [ "$RC" -eq 2 ]; then ok "cross-tier: emptying the SAFE preset under STRICT is refused (rc 2)"; else no "cross-tier: emptying the SAFE preset under STRICT is refused" "rc=$RC [$(printf '%s\n' "$OUT" | tr '\n' ' ')]"; fi
if jrnl 'overrides-reject reason=reject-last tier=safe'; then ok "cross-tier: the journal names the refusal and the preset it would empty (active tier=strict, tier=safe)"; else no "cross-tier: the journal names reject-last + tier=safe" "$(tail -2 "$SB/state/journal.log" 2>/dev/null | tr '\n' ' ')"; fi
# The UI's half: ONE token line naming the refusal and the preset it would have
# emptied. exact-match (-x) with the tier value, so dropping tier= or reporting
# the ACTIVE tier (strict) here fails.
if grep -qx 'OVERRIDES-REJECT reason=reject-last tier=safe' "$SB/stderr" 2>/dev/null; then ok "cross-tier: the UI token names reject-last + the preset it would empty (tier=safe)"; else no "cross-tier: the UI token names reject-last + tier=safe" "stderr=[$(cat "$SB/stderr" 2>/dev/null | tr '\n' ' ')]"; fi
if grep -q 'refusing to turn off the last blocked domain' "$SB/stderr" 2>/dev/null && ! grep -q '=off' "$SB/stderr" 2>/dev/null; then ok "cross-tier: the refusal explains itself on stderr (no payload echo)"; else no "cross-tier: the refusal explains itself on stderr" "[$(tr '\n' ' ' < "$SB/stderr" 2>/dev/null)]"; fi
if cmp -s "$SB/state/overrides.txt" "$SB/ov-keep.txt"; then ok "cross-tier: the stored diff is byte-identical after the refusal"; else no "cross-tier: the stored diff is byte-identical" "[$(tr '\n' ' ' < "$SB/state/overrides.txt" 2>/dev/null)]"; fi
ov_no_tmp "cross-tier: no scratch file left behind"
# The counterfactual the old active-only check accepted, stated as a number: the
# same payload leaves the ACTIVE STRICT list with rows (115 - 20 exact rules + 8
# anchors), so only the SAFE check can be what refused it.
ov_strict_left=$(grep -c '^=' "$SB/appdir/filter/filter-input-strict.txt" | tr -d ' ')
if [ "$((ov_strict_left - ov_safe_n))" -gt 0 ]; then ok "cross-tier: the STRICT list would still hold $((ov_strict_left - ov_safe_n)) exact rules (active-only check would have passed it)"; else no "cross-tier: the STRICT counterfactual is non-empty" "$ov_strict_left - $ov_safe_n"; fi
# And the same payload against the ACTIVE SAFE tier is refused the same way.
printf 'tier=safe\n' > "$SB/state/state"
OV_PAYLOAD="$(sed 's/$/=off/' "$SB/ov-safe-rows.txt")"
ov_run save
if [ "$RC" -eq 2 ] && tail -1 "$SB/state/journal.log" 2>/dev/null | grep -q 'overrides-reject reason=reject-last tier=safe'; then ok "reject-last: the ACTIVE preset emptied is refused (tier=safe, rc 2)"; else no "reject-last: the ACTIVE preset emptied is refused" "rc=$RC $(tail -1 "$SB/state/journal.log" 2>/dev/null)"; fi
if grep -qx 'OVERRIDES-REJECT reason=reject-last tier=safe' "$SB/stderr" 2>/dev/null; then ok "reject-last: the UI token matches the journal (tier=safe, active tier too)"; else no "reject-last: the UI token matches the journal" "stderr=[$(cat "$SB/stderr" 2>/dev/null | tr '\n' ' ')]"; fi
if cmp -s "$SB/state/overrides.txt" "$SB/ov-keep.txt"; then ok "reject-last: the stored diff stands after both refusals"; else no "reject-last: the stored diff stands" "[$(tr '\n' ' ' < "$SB/state/overrides.txt" 2>/dev/null)]"; fi
cleanup_app_sandbox

# --- T5 case 15 (review F1b/F2): the materialize seam cannot publish 0 entries --
# Belt and braces behind the save check: a diff can PRE-EXIST (hand-edited file, an
# app version that predates F1a, a preset that shrank under it), and the tier switch
# is exactly when it bites — the new preset is smaller, the stored diff was written
# against the old one, and the result is a comment-only list. materialize is the
# last thing between the diff and the filter, so it refuses to publish a list with
# no entries: fail closed, journal `materialize-fail reason=empty-list`, the live
# filter input byte-identical (the previous list keeps protecting), no scratch file
# left behind — and the next materialize, once the diff is gone, publishes again.
tier_sandbox
printf 'tier=strict\n' > "$SB/state/state"
probe_run materialize 192.168.5.5 >/dev/null
if cmp -s "$SB/state/filter-input.txt" "$SB/appdir/filter/filter-input-strict.txt"; then ok "empty-list: the STRICT preset is materialized first (the list to protect with)"; else no "empty-list: the STRICT preset is materialized first" "$(sed -n '1,3p' "$SB/state/filter-input.txt" | tr '\n' ' ')"; fi
cp "$SB/state/filter-input.txt" "$SB/ov-prev.txt"
ov_prev_n=$(grep -c . "$SB/ov-prev.txt" | tr -d ' ')
printf 'tier=safe\n' > "$SB/state/state"
ov_names | while IFS= read -r n; do printf -- '-%s\n' "$n"; done > "$SB/state/overrides.txt"
OUT="$(probe_run materialize 192.168.5.5 2>"$SB/stderr")"
if [ "$(printf '%s\n' "$OUT" | sed -n '1p')" = "rc=1" ]; then ok "empty-list: the switch + emptying diff fails closed (rc 1)"; else no "empty-list: the switch + emptying diff fails closed" "got [$OUT]"; fi
if jrnl 'materialize-fail reason=empty-list'; then ok "empty-list: journal names the reason"; else no "empty-list: journal names the reason" "$(tail -2 "$SB/state/journal.log" 2>/dev/null | tr '\n' ' ')"; fi
# The UI's half of this sibling refusal: the same token family as save's
# reject-last, naming the seam and the ACTIVE tier whose list would have been
# emptied. Delete the echo in materialize_config and this case fails.
if grep -qx 'OVERRIDES-REJECT reason=empty-list tier=safe' "$SB/stderr" 2>/dev/null; then ok "empty-list: the UI token names the seam + the active tier (tier=safe)"; else no "empty-list: the UI token names the seam + the active tier" "stderr=[$(cat "$SB/stderr" 2>/dev/null | tr '\n' ' ')]"; fi
if cmp -s "$SB/state/filter-input.txt" "$SB/ov-prev.txt"; then ok "empty-list: the live filter input is byte-identical (the previous list keeps protecting)"; else no "empty-list: the live filter input is byte-identical" "now $(grep -c . "$SB/state/filter-input.txt") lines"; fi
if [ "$(sed -e '/^#/d' -e '/^$/d' "$SB/state/filter-input.txt" | wc -l | tr -d ' ')" = "$(sed -e '/^#/d' -e '/^$/d' "$SB/ov-prev.txt" | wc -l | tr -d ' ')" ] && [ "$ov_prev_n" -gt 0 ]; then ok "empty-list: the published list still holds its entries ($ov_prev_n lines)"; else no "empty-list: the published list still holds its entries" "$(grep -c . "$SB/state/filter-input.txt")/$ov_prev_n"; fi
if [ -z "$(find "$SB/state" -maxdepth 1 -name 'filter-input.txt.*' 2>/dev/null)" ]; then ok "empty-list: no scratch file left behind"; else no "empty-list: no scratch file left behind" "$(find "$SB/state" -maxdepth 1 -name 'filter-input.txt.*' | tr '\n' ' ')"; fi
# The caller's side of the same refusal: apply fails open with reason=materialize
# and the rules it may have already changed are rolled back by the existing path.
run_app apply.sh
assert_result "empty-list: apply fails open (reason=materialize)" fail materialize
# apply's stdout is unchanged (the RESULT/reason block the panel parses), and it
# still must carry the token on stderr so the UI can say WHY it failed.
if grep -qx 'OVERRIDES-REJECT reason=empty-list tier=safe' "$SB/stderr" 2>/dev/null; then ok "empty-list: apply's stderr carries the same token (stdout stays the block)"; else no "empty-list: apply's stderr carries the same token" "stderr=[$(cat "$SB/stderr" 2>/dev/null | tr '\n' ' ')]"; fi
if jrnl 'materialize-fail reason=empty-list'; then ok "empty-list: apply's journal still names the real cause"; else no "empty-list: apply's journal still names the real cause" "$(tail -3 "$SB/state/journal.log" 2>/dev/null | tr '\n' ' ')"; fi
if cmp -s "$SB/state/filter-input.txt" "$SB/ov-prev.txt"; then ok "empty-list: apply left the live list untouched too"; else no "empty-list: apply left the live list untouched too" "$(grep -c . "$SB/state/filter-input.txt") lines"; fi
# Positive control: the guard is about the RESULT, not about diffs.
rm -f "$SB/state/overrides.txt"
OUT="$(probe_run materialize 192.168.5.5 2>"$SB/stderr")"
if [ "$(printf '%s\n' "$OUT" | sed -n '1p')" = "rc=0" ] && cmp -s "$SB/state/filter-input.txt" "$SB/appdir/filter/filter-input-safe.txt"; then ok "empty-list: with the diff gone the SAFE list materializes byte for byte"; else no "empty-list: with the diff gone the SAFE list materializes" "got [$OUT]"; fi
# No false positive: a materialize that publishes says nothing on stderr.
if ! grep -q '^OVERRIDES-REJECT' "$SB/stderr" 2>/dev/null; then ok "empty-list: a successful materialize emits no token"; else no "empty-list: a successful materialize emits no token" "stderr=[$(cat "$SB/stderr" 2>/dev/null | tr '\n' ' ')]"; fi
cleanup_app_sandbox

# --- Summary -----------------------------------------------------------------
printf '\n%s passed, %s failed\n' "$pass" "$fail"


if [ "$fail" -ne 0 ]; then
  exit 1
fi
exit 0
