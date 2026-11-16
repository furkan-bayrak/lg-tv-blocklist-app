#!/bin/sh
# Sourced by run-tests.sh after its sandbox/supervisor helpers are defined.
# Before the fix, a live keeper plus passing canaries could retain ON indefinitely
# after removal, and guard ignored removal while that keeper still appeared alive.
# Pin deletion after shell load: no cleanup callback or surviving app file exists.
for removed_manager in keeper guard; do
  for removed_fault in none busy persistent; do
    new_app_sandbox
    printf 'pointer=on\nupstream=192.168.179.1\ntier=strict\n' > "$SB/state/state"
    printf '%s\n' '+kept.example' > "$SB/state/overrides.txt"
    seed_rules 192.168.179.1
    echo 'R nat OUTPUT -j FOREIGN' >> "$TEST_IPT_STATE"
    start_fake_filter
    serving_pid=$(cat "$SB/state/filter.pid")
    if [ "$removed_manager" = keeper ]; then
      printf '%s\n' 'guard_running() { return 0; }' >> "$SB/appdir/scripts/common.sh"
      ln -s "$SB/appdir/scripts/boot.sh" "$SB/hookdir/50-lgtv-blocklist-app"
    else
      sh -c 'sleep 60; :' keeper-fake-$SB &
      echo $! > "$SB/state/keeper.pid"
      cat "$SB/state/keeper.pid" >> "$SB/state/fake-pids"
      printf 'foreign hook\n' > "$SB/hookdir/50-lgtv-blocklist-app"
    fi
    mkfifo "$SB/state/tick-release"
    exec 7<> "$SB/state/tick-release"
    printf '%s\n' '#!/bin/sh' \
      'if [ ! -e "$LGTVB_STATE_DIR/tick-ready" ]; then' \
      '  : > "$LGTVB_STATE_DIR/tick-ready"' \
      '  read -r reply < "$LGTVB_STATE_DIR/tick-release"' \
      'fi' \
      'exec /bin/sleep "$@"' > "$SB/bin/sleep"
    chmod +x "$SB/bin/sleep"
    run_bg "$removed_manager.sh"
    removed_pid=$LAST_BG_PID
    wait_file "$SB/state/tick-ready" 40 || no "uninstall $removed_manager $removed_fault: supervisor loaded" 'no barrier'
    case $removed_fault in
      busy) mkdir "$SB/state/lock"; echo $$ > "$SB/state/lock/pid" ;;
      persistent) echo '-D always' > "$TEST_IPT_STATE.fault" ;;
    esac
    rm -rf "$SB/appdir"
    echo go >&7
    exec 7>&-
    if [ "$removed_fault" = busy ]; then
      sleep 1.5
      if ! chk_log 'iptables' && kill -0 "$serving_pid" 2>/dev/null && [ "$(cat "$SB/state/lock/pid")" = "$$" ]; then ok "uninstall $removed_manager busy: resolver and foreign lock preserved"; else no "uninstall $removed_manager busy: resolver and foreign lock preserved" 'mutated while locked'; fi
      rm -f "$SB/state/lock/pid"; rmdir "$SB/state/lock"
    elif [ "$removed_fault" = persistent ]; then
      wait_file "$SB/state/cleanup-pending" 40 || no "uninstall $removed_manager persistent: cleanup attempted" 'no pending marker'
      if chk_state '^pointer=on$' && [ "$(cat "$SB/state/filter.pid" 2>/dev/null)" = "$serving_pid" ] && kill -0 "$serving_pid" 2>/dev/null && ! jrnl 'terminal-giveup'; then ok "uninstall $removed_manager persistent: failed detach retains DNS and truthful ON"; else no "uninstall $removed_manager persistent: failed detach retains DNS and truthful ON" 'false OFF or dead filter'; fi
      rm -f "$TEST_IPT_STATE.fault"
    fi
    if wait_for "$SB/state/state" '^pointer=off$' 60 && wait_for "$TEST_LOG" 'filter-killed' 40; then ok "uninstall $removed_manager $removed_fault: fails open without app code"; else no "uninstall $removed_manager $removed_fault: fails open without app code" 'OFF/kill timeout'; fi
    dell=$(log_line '-t nat -D OUTPUT -j LGTVBLK')
    killl=$(log_line 'filter-killed')
    if [ -n "$dell" ] && [ -n "$killl" ] && [ "$dell" -lt "$killl" ] && ! grep -q 'LGTVBLK' "$TEST_IPT_STATE"; then ok "uninstall $removed_manager $removed_fault: cleanup precedes filter kill"; else no "uninstall $removed_manager $removed_fault: cleanup precedes filter kill" "delete=$dell kill=$killl"; fi
    if grep -qx 'R nat OUTPUT -j FOREIGN' "$TEST_IPT_STATE" && chk_state '^tier=strict$' && grep -qx '+kept.example' "$SB/state/overrides.txt"; then ok "uninstall $removed_manager $removed_fault: foreign rules and preferences survive"; else no "uninstall $removed_manager $removed_fault: foreign rules and preferences survive" 'unexpected mutation'; fi
    if [ "$removed_manager" = keeper ]; then
      if [ -L "$SB/hookdir/50-lgtv-blocklist-app" ] && [ ! -e "$SB/hookdir/50-lgtv-blocklist-app" ]; then ok "uninstall keeper $removed_fault: startup is a harmless dangling link"; else no "uninstall keeper $removed_fault: startup is a harmless dangling link" 'hook changed'; fi
    else
      if grep -qx 'foreign hook' "$SB/hookdir/50-lgtv-blocklist-app" && kill -0 "$(cat "$SB/state/keeper.pid")" 2>/dev/null; then ok "uninstall guard $removed_fault: foreign hook and live keeper untouched"; else no "uninstall guard $removed_fault: foreign hook and live keeper untouched" 'foreign state changed'; fi
    fi
    exit_check "uninstall $removed_manager $removed_fault: supervisor exits" "$removed_pid" 30
    if [ ! -d "$SB/state/lock" ] && ! chk_log ' -I OUTPUT'; then ok "uninstall $removed_manager $removed_fault: no lock leak or re-arm"; else no "uninstall $removed_manager $removed_fault: no lock leak or re-arm" 'lock or new rules'; fi
    wait "$removed_pid" 2>/dev/null || true
    stop_t4
  done
done

# Removal during an already-running recovery cannot add redirects again.
new_app_sandbox
printf '%s\n' \
  'SELF_DIR=${0%/*}; . "$SELF_DIR/common.sh"' \
  'removed_rearm() {' \
  '  rm -rf "$APP_DIR"' \
  '  rules_on_verified 192.168.179.1' \
  '  echo "rearm-rc=$? reason=$RULES_FAIL"' \
  '}' \
  'removed_rearm' > "$SB/appdir/scripts/removal-rearm.sh"
run_app removal-rearm.sh
if [ "$OUT" = 'rearm-rc=1 reason=rules' ] && ! chk_log 'iptables'; then ok 'uninstall recovery: loaded writer refuses re-arm'; else no 'uninstall recovery: loaded writer refuses re-arm' "$OUT"; fi
cleanup_app_sandbox

run_startup() {
  OUT="$(env PATH="$SB/bin:$BASE_PATH" LGTVB_STATE_DIR="$SB/state" LGTVB_HOOK_DIR="$SB/hookdir" \
    "$SH" "$SB/appdir/scripts/startup.sh" "$@" 2>"$SB/stderr")"
  RC=$?
}

new_app_sandbox
printf 'pointer=on\ntier=strict\n' > "$SB/state/state"
printf '%s\n' '+kept.example' > "$SB/state/overrides.txt"
seed_rules 192.168.179.1
cp "$TEST_IPT_STATE" "$SB/rules-before"
for startup_action in register register remove remove; do
  run_startup "$startup_action"
  case $startup_action in register) startup_reason=registered ;; remove) startup_reason=removed ;; esac
  assert_result "startup $startup_action: idempotent success" ok "$startup_reason"
  if [ "$startup_action" = register ]; then
    if [ "$(readlink "$SB/hookdir/50-lgtv-blocklist-app")" = "$SB/appdir/scripts/boot.sh" ]; then ok 'startup register: actual owned link'; else no 'startup register: actual owned link' 'wrong link'; fi
  else
    if [ ! -e "$SB/hookdir/50-lgtv-blocklist-app" ] && [ ! -L "$SB/hookdir/50-lgtv-blocklist-app" ]; then ok 'startup remove: actual absence'; else no 'startup remove: actual absence' 'entry remains'; fi
  fi
done
if cmp -s "$TEST_IPT_STATE" "$SB/rules-before" && chk_state '^pointer=on$' && chk_state '^tier=strict$' && grep -qx '+kept.example' "$SB/state/overrides.txt" && [ ! -e "$SB/state/keeper.pid" ] && [ ! -e "$SB/state/guard.pid" ]; then ok 'startup: no protection or preference side effects'; else no 'startup: no protection or preference side effects' 'unexpected mutation'; fi
cleanup_app_sandbox

# Our exact target is still ours if boot.sh was removed from a damaged package.
new_app_sandbox
ln -s "$SB/appdir/scripts/boot.sh" "$SB/hookdir/50-lgtv-blocklist-app"
rm "$SB/appdir/scripts/boot.sh"
run_startup remove
assert_result 'startup remove: removes own dangling link' ok removed
if [ ! -L "$SB/hookdir/50-lgtv-blocklist-app" ]; then ok 'startup remove: own dangling link is absent'; else no 'startup remove: own dangling link is absent' 'link remains'; fi
cleanup_app_sandbox

# An unusable hook directory must not be overwritten or reported registered.
new_app_sandbox
rmdir "$SB/hookdir"; printf 'foreign parent\n' > "$SB/hookdir"
run_startup register
assert_result 'startup register: unusable parent fails truthfully' fail hook-write-failed
if grep -qx 'foreign parent' "$SB/hookdir"; then ok 'startup register: preserves conflicting parent'; else no 'startup register: preserves conflicting parent' 'parent overwritten'; fi
cleanup_app_sandbox

for foreign_kind in file directory symlink dangling; do
  new_app_sandbox
  case $foreign_kind in
    file) printf 'foreign\n' > "$SB/hookdir/50-lgtv-blocklist-app" ;;
    directory) mkdir "$SB/hookdir/50-lgtv-blocklist-app"; printf 'foreign\n' > "$SB/hookdir/50-lgtv-blocklist-app/keep" ;;
    symlink) printf 'foreign\n' > "$SB/foreign"; ln -s "$SB/foreign" "$SB/hookdir/50-lgtv-blocklist-app" ;;
    dangling) ln -s "$SB/foreign-missing" "$SB/hookdir/50-lgtv-blocklist-app" ;;
  esac
  for startup_action in register remove; do
    run_startup "$startup_action"
    assert_result "startup $startup_action: refuses foreign $foreign_kind" fail hook-conflict
  done
  case $foreign_kind in
    directory) preserved=$(cat "$SB/hookdir/50-lgtv-blocklist-app/keep" 2>/dev/null) ;;
    dangling) preserved=$(readlink "$SB/hookdir/50-lgtv-blocklist-app"); [ "$preserved" != "$SB/foreign-missing" ] || preserved=foreign ;;
    *) preserved=$(cat "$SB/hookdir/50-lgtv-blocklist-app" 2>/dev/null) ;;
  esac
  if [ "$preserved" = foreign ]; then ok "startup: preserves foreign $foreign_kind"; else no "startup: preserves foreign $foreign_kind" 'entry changed'; fi
  run_app check.sh
  if printf '%s\n' "$OUT" | grep -qx 'hook=other'; then ok "startup status: $foreign_kind is a conflict"; else no "startup status: $foreign_kind is a conflict" "$OUT"; fi
  cleanup_app_sandbox
done

for startup_failure in ln rm; do
  new_app_sandbox
  if [ "$startup_failure" = rm ]; then
    ln -s "$SB/appdir/scripts/boot.sh" "$SB/hookdir/50-lgtv-blocklist-app"
    startup_action=remove
  else
    startup_action=register
  fi
  printf '%s\n' '#!/bin/sh' \
    'case "$*" in *50-lgtv-blocklist-app*) exit 1 ;; esac' \
    "exec /bin/$startup_failure \"\$@\"" > "$SB/bin/$startup_failure"
  chmod +x "$SB/bin/$startup_failure"
  run_startup "$startup_action"
  assert_result "startup $startup_action: failed write is truthful" fail hook-write-failed
  if [ ! -d "$SB/state/lock" ]; then ok "startup $startup_action: failure releases lock"; else no "startup $startup_action: failure releases lock" 'lock leaked'; fi
  /bin/rm -f "$SB/bin/$startup_failure"
  cleanup_app_sandbox
done

for missing_component in scripts/common.sh scripts/apply.sh scripts/rollback.sh scripts/boot.sh scripts/keeper.sh scripts/guard.sh scripts/startup.sh scripts/tier.sh scripts/overrides.sh scripts/dnsq.sh scripts/dnsq.js filter/dnscrypt-proxy filter/dnscrypt-proxy.toml.template filter/forward-rules.txt.template filter/filter-input.txt filter/filter-input-safe.txt filter/filter-input-strict.txt filter/domains.json; do
  new_sandbox
  # Keep common.sh sourceable but non-executable to exercise its package gate.
  if [ "$missing_component" = scripts/common.sh ]; then chmod -x "$SB/appdir/$missing_component"; else rm "$SB/appdir/$missing_component"; fi
  OUT="$(run_check "$SB/hookdir")"; RC=$?
  if [ "$RC" -eq 0 ] && printf '%s\n' "$OUT" | grep -qx 'scripts=missing'; then ok "readiness: damaged $missing_component is not ready"; else no "readiness: damaged $missing_component is not ready" "$OUT"; fi
  cleanup_app_sandbox
done
