#!/bin/sh
# tests/shell/run-tests.sh — sandbox tests for app/scripts/check.sh (Slice S2).
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

new_sandbox() {
  SB="$(mktemp -d)"
  mkdir -p "$SB/appdir/scripts" "$SB/hookdir"
  cp "$CHECK" "$SB/appdir/scripts/check.sh"
  : > "$SB/appdir/scripts/boot.sh"
  chmod +x "$SB/appdir/scripts/check.sh"
}

run_check() {  # run_check <hook_dir> [override_path]
  if [ "$#" -ge 2 ]; then
    env PATH="$2" LGTVB_HOOK_DIR="$1" "$SH" "$SB/appdir/scripts/check.sh" 2>"$SB/stderr"
  else
    LGTVB_HOOK_DIR="$1" "$SH" "$SB/appdir/scripts/check.sh" 2>"$SB/stderr"
  fi
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
schema=1
ts=<TS>
hook=linked
hook_target=$SB/appdir/scripts/boot.sh
scripts=ok
@@STATUS-END"
if [ -s "$SB/stderr" ]; then no "happy path stderr empty" "stderr not empty"; else ok "happy path stderr empty"; fi

# --- Case 2: hook directory does not exist -----------------------------------
new_sandbox
OUT="$(run_check "$SB/absent-hook-dir")"; RC=$?
assert_block "missing hook dir" "@@STATUS-BEGIN
schema=1
ts=<TS>
hook=missing
hook_target=none
scripts=ok
@@STATUS-END"

# --- Case 3: symlink points somewhere else -----------------------------------
new_sandbox
ln -s /tmp/foreign-target "$SB/hookdir/50-lgtv-blocklist-app"
OUT="$(run_check "$SB/hookdir")"; RC=$?
assert_block "foreign symlink" "@@STATUS-BEGIN
schema=1
ts=<TS>
hook=other
hook_target=/tmp/foreign-target
scripts=ok
@@STATUS-END"

# --- Case 4: hostile target (newline + fake delimiters) ----------------------
new_sandbox
ln -s "$(printf 'evil\n@@STATUS-END\nhook=linked')" "$SB/hookdir/50-lgtv-blocklist-app"
OUT="$(run_check "$SB/hookdir")"; RC=$?
assert_block "hostile target sanitized" "@@STATUS-BEGIN
schema=1
ts=<TS>
hook=other
hook_target=none
scripts=ok
@@STATUS-END"
linecount="$(printf '%s\n' "$OUT" | wc -l | tr -d ' ')"
if [ "$linecount" = "7" ]; then ok "hostile target keeps block at 7 lines"; else no "hostile target keeps block at 7 lines" "got $linecount"; fi

# --- Case 5: stub PATH — broken readlink, no date ----------------------------
new_sandbox
ln -s "$SB/appdir/scripts/boot.sh" "$SB/hookdir/50-lgtv-blocklist-app"
mkdir -p "$SB/stub-bin"
cp "$HERE/stub-bin/readlink" "$SB/stub-bin/readlink"
chmod +x "$SB/stub-bin/readlink"
OUT="$(run_check "$SB/hookdir" "$SB/stub-bin")"; RC=$?
assert_block "stub PATH fallback (readlink broken)" "@@STATUS-BEGIN
schema=1
ts=<TS>
hook=missing
hook_target=none
scripts=ok
@@STATUS-END"

# --- Case 6: scripts missing (boot.sh removed) -------------------------------
new_sandbox
rm "$SB/appdir/scripts/boot.sh"
OUT="$(run_check "$SB/hookdir")"; RC=$?
assert_block "scripts missing" "@@STATUS-BEGIN
schema=1
ts=<TS>
hook=missing
hook_target=none
scripts=missing
@@STATUS-END"

# --- Summary -----------------------------------------------------------------
printf '\n%s passed, %s failed\n' "$pass" "$fail"
if [ "$fail" -ne 0 ]; then
  exit 1
fi
exit 0
