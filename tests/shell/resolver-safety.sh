#!/bin/sh
# Sourced by run-tests.sh: configured paths must independently prove filtering.
for resolver_case in ipv4-success ipv6-refused ipv6-bypass ipv6-first-bypass ipv4-bypass nxdomain timeout control-refused missing unreadable nonregular empty comments malformed; do
  new_app_sandbox
  printf '%s\n' 'ensure_supervisors() { :; }' >> "$SB/appdir/scripts/common.sh"
  blocked="$(grep -m1 '^=' "$SB/appdir/filter/filter-input.txt" | cut -c2-)"
  printf '%s 2\n' "$blocked" > "$TEST_DNSQ_NAME_RC"
  resolver_expect=fail
  case $resolver_case in
    ipv4-success)
      printf 'nameserver 127.0.0.1\nnameserver 192.0.2.53\n' > "$SB/resolv.conf"
      resolver_expect=on ;;
    ipv6-refused)
      printf 'nameserver ::1\nnameserver 127.0.0.1\n' > "$SB/resolv.conf"
      resolver_expect=on ;;
    ipv6-bypass|ipv6-first-bypass|nxdomain|timeout|control-refused)
      if [ "$resolver_case" = ipv6-first-bypass ]; then
        printf 'nameserver ::1\nnameserver 127.0.0.1\n' > "$SB/resolv.conf"
      else
        printf 'nameserver 127.0.0.1\nnameserver ::1\n' > "$SB/resolv.conf"
      fi
      case $resolver_case in
        nxdomain) printf '::1 %s 2 3\n' "$blocked" > "$TEST_DNSQ_QUERY_RC" ;;
        timeout) printf '::1 %s 1 0\n' "$blocked" > "$TEST_DNSQ_QUERY_RC" ;;
        control-refused) printf '::1 example.com 2 5\n' > "$TEST_DNSQ_QUERY_RC" ;;
        *) printf '::1 %s 0 0\n' "$blocked" > "$TEST_DNSQ_QUERY_RC" ;;
      esac ;;
    ipv4-bypass)
      printf 'nameserver 127.0.0.1\nnameserver 192.0.2.53\n' > "$SB/resolv.conf"
      printf '192.0.2.53 %s 0 0\n' "$blocked" > "$TEST_DNSQ_QUERY_RC" ;;
    missing) rm "$SB/resolv.conf" ;;
    nonregular) rm "$SB/resolv.conf"; mkdir "$SB/resolv.conf" ;;
    empty) : > "$SB/resolv.conf" ;;
    comments) printf '# nameserver ::1\nsearch isolated.test\n' > "$SB/resolv.conf" ;;
    malformed) printf 'nameserver 127.0.0.1\nnameserver # missing address\n' > "$SB/resolv.conf" ;;
    unreadable)
      # Simulate a config read error even under root, where chmod 000 is readable.
      TEST_REAL_AWK="$(command -v awk)"
      export TEST_REAL_AWK
      printf '%s\n' '#!/bin/sh' \
        'case "$*" in *"$LGTVB_RESOLV_CONF"*) exit 1 ;; esac' \
        'exec "$TEST_REAL_AWK" "$@"' > "$SB/bin/awk"
      chmod +x "$SB/bin/awk" ;;
  esac
  run_app apply.sh
  if [ "$resolver_expect" = on ]; then
    assert_result "resolver $resolver_case: verified" on verified
    if chk_state '^pointer=on$'; then ok "resolver $resolver_case: ON only after all paths pass"; else no "resolver $resolver_case: ON only after all paths pass" 'not ON'; fi
    if grep -qx '127.0.0.1 example.com 53' "$TEST_DNSQ_QUERY_RC.log" && grep -qx "127.0.0.1 $blocked 53" "$TEST_DNSQ_QUERY_RC.log"; then ok "resolver $resolver_case: IPv4 loopback check retained"; else no "resolver $resolver_case: IPv4 loopback check retained" 'missing probes'; fi
    case $resolver_case in ipv4-success) resolver_server=192.0.2.53 ;; *) resolver_server=::1 ;; esac
    if grep -qx "$resolver_server example.com 53" "$TEST_DNSQ_QUERY_RC.log" && grep -qx "$resolver_server $blocked 53" "$TEST_DNSQ_QUERY_RC.log"; then ok "resolver $resolver_case: configured path tested with A-query canaries"; else no "resolver $resolver_case: configured path tested with A-query canaries" 'missing configured probes'; fi
  else
    assert_result "resolver $resolver_case: fail-open reason" fail verify-resolver
    if ! chk_state '^pointer=on$' && [ ! -e "$SB/state/filter.pid" ] && ! grep -q LGTVBLK "$TEST_IPT_STATE"; then ok "resolver $resolver_case: no misleading ON or retained redirect"; else no "resolver $resolver_case: no misleading ON or retained redirect" 'ON/filter/rules remain'; fi
    if wait_for "$TEST_LOG" filter-killed 40; then
      dell=$(log_line '-t nat -D OUTPUT -j LGTVBLK')
      killl=$(log_line filter-killed)
      if [ -n "$dell" ] && [ "$dell" -lt "$killl" ]; then ok "resolver $resolver_case: verified detach before filter kill"; else no "resolver $resolver_case: verified detach before filter kill" "delete=$dell kill=$killl"; fi
    else
      no "resolver $resolver_case: verified detach before filter kill" 'no filter exit evidence'
    fi
  fi
  cleanup_app_sandbox
done

# A healthy process/port and intact IPv4 rules must not hide a newly configured
# bypass resolver. The fixture changes only resolv.conf, never the modeled rules.
new_app_sandbox
printf '%s\n' 'ensure_supervisors() { :; }' 'guard_running() { return 0; }' >> "$SB/appdir/scripts/common.sh"
blocked="$(grep -m1 '^=' "$SB/appdir/filter/filter-input.txt" | cut -c2-)"
printf '%s 2\n' "$blocked" > "$TEST_DNSQ_NAME_RC"
run_app apply.sh
assert_result 'resolver keeper change: initial IPv4 ON verified' on verified
: > "$TEST_DNSQ_QUERY_RC.log"
run_bg keeper.sh
if wait_for "$TEST_DNSQ_QUERY_RC.log" "127.0.0.1 $blocked 53" 40; then ok 'resolver keeper change: healthy periodic guard runs'; else no 'resolver keeper change: healthy periodic guard runs' 'no configured probe'; fi
printf '::1 %s 0 0\n' "$blocked" > "$TEST_DNSQ_QUERY_RC"
printf 'nameserver ::1\nnameserver 127.0.0.1\n' > "$SB/resolv-next"
mv "$SB/resolv-next" "$SB/resolv.conf"
if wait_for "$SB/state/state" '^pointer=off$' 60 && wait_for "$TEST_LOG" filter-killed 40; then ok 'resolver keeper change: fails open on new bypass path'; else no 'resolver keeper change: fails open on new bypass path' 'no verified OFF'; fi
if jrnl 'terminal-giveup reason=verify-resolver' && [ -e "$SB/state/gaveup" ] && ! grep -q LGTVBLK "$TEST_IPT_STATE"; then ok 'resolver keeper change: actionable reason and detached rules'; else no 'resolver keeper change: actionable reason and detached rules' 'missing reason/marker or rules remain'; fi
dell=$(log_line '-t nat -D OUTPUT -j LGTVBLK')
killl=$(log_line filter-killed)
if [ -n "$dell" ] && [ -n "$killl" ] && [ "$dell" -lt "$killl" ]; then ok 'resolver keeper change: detach precedes kill'; else no 'resolver keeper change: detach precedes kill' "delete=$dell kill=$killl"; fi
stop_t4
