#!/bin/sh
# common.sh — shared helpers for the app's TV-side scripts. Sourced, never executed.
# Busybox ash compatible (LG G1, webOS 6). Test-only overrides:
# LGTVB_STATE_DIR, LGTVB_FILTER_BIN, LGTVB_DNSQ, LGTVB_TICK, LGTVB_GUARD_TICK,
# LGTVB_BACKOFF, LGTVB_UWAIT_ROUNDS, LGTVB_UWAIT_SLEEP, LGTVB_GUARD_GRACE,
# LGTVB_RULES_RETRY, LGTVB_RULES_RETRY_SLEEP, LGTVB_HOOK_DIR, LGTVB_TARGETS_FILE,
# LGTVB_CANARY_EVERY, LGTVB_PROC_TCP.
#
# This file is a sourced library: its variables are consumed by the scripts that
# source it (apply/rollback/check/boot/keeper/guard), so shellcheck's "appears
# unused" (SC2034) is a false positive here.
# shellcheck disable=SC2034

SELF=$(readlink -f "$0" 2>/dev/null)
[ -n "$SELF" ] || SELF="$0"
SELF_DIR=${SELF%/*}
APP_DIR=${SELF_DIR%/*}
STATE=${LGTVB_STATE_DIR:-/var/lib/webosbrew/lg-tv-blocklist-app}
HOOK_DIR=${LGTVB_HOOK_DIR:-/var/lib/webosbrew/init.d}
HOOK_LINK="$HOOK_DIR/50-lgtv-blocklist-app"
FILTER_BIN=${LGTVB_FILTER_BIN:-"$APP_DIR/filter/dnscrypt-proxy"}
FILTER_TOML_TMPL="$APP_DIR/filter/dnscrypt-proxy.toml.template"
FORWARD_TMPL="$APP_DIR/filter/forward-rules.txt.template"
FILTER_INPUT_SRC="$APP_DIR/filter/filter-input.txt"
# S6a T2: the ACTIVE TIER selects which bundled list is materialized. The key
# is a root-only state value; anything that is not exactly 'strict' (a missing
# key, a stale or garbled value) means SAFE — the fresh-install default, and
# the gentler of the two lists, so an unreadable state can never silently
# promote the TV to the aggressive tier.
TIER_DEFAULT=safe
FILTER_PORT=5335
RULES_NAT=LGTVBLK
RULES_FLT=LGTVBLK-FILTER
TICK=${LGTVB_TICK:-5}
GUARD_TICK=${LGTVB_GUARD_TICK:-10}
BACKOFF=${LGTVB_BACKOFF:-4}
# Leg R (S4 T8, 2026-10-01): after an AP return, G1's WLAN rejoin took 5-7 min
# (kernel scan cadence ~4 min), overshooting the old 12-round budget. 90 x 10 s
# = 15 min so a real outage auto-recovers once the path returns; the bounded
# terminal still fires for longer outages (fail-open by design).
UWAIT_ROUNDS=${LGTVB_UWAIT_ROUNDS:-90}
UWAIT_SLEEP=${LGTVB_UWAIT_SLEEP:-10}
GUARD_GRACE=${LGTVB_GUARD_GRACE:-6}
RULES_RETRY=${LGTVB_RULES_RETRY:-3}
RULES_RETRY_SLEEP=${LGTVB_RULES_RETRY_SLEEP:-2}
# Cheap probe passed → run the expensive functional canary every CANARY_EVERY ticks
# (≥1; 1 = every tick). Default 6 ≈ 30 s at TICK=5.
CANARY_EVERY=${LGTVB_CANARY_EVERY:-6}
# Clamp ≥1: 0/non-numeric would make $((tseq % CANARY_EVERY)) a fatal arithmetic
# error in the keeper tick; fall back to the default instead.
[ "$CANARY_EVERY" -gt 0 ] 2>/dev/null || CANARY_EVERY=6
# All knobs: numeric only, no leading zeros (busybox ash $(( )) treats 08 as octal → error).
CAP=none

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$STATE/journal.log" 2>/dev/null
  sz=$(wc -c < "$STATE/journal.log" 2>/dev/null || echo 0)
  if [ "$sz" -gt 65536 ]; then
    mv -f "$STATE/journal.log" "$STATE/journal.log.1"
    chmod 600 "$STATE/journal.log.1" 2>/dev/null
  fi
}

state_get() {  # fixed-key lookup: the key is a literal prefix, never a regex
  while IFS= read -r line; do
    case $line in
      "$1="*) printf '%s\n' "${line#"$1="}"; return 0 ;;
    esac
  done 2>/dev/null < "$STATE/state"
  return 1
}
state_set() {  # same literal-key discipline as state_get: the key is never a regex/glob
  f="$STATE/state"; tmp="$STATE/state.tmp"
  : > "$tmp"
  if [ -f "$f" ]; then
    while IFS= read -r line; do
      case $line in
        "$1="*) ;;                       # drop only the exact literal key
        *) printf '%s\n' "$line" >> "$tmp" ;;
      esac
    done 2>/dev/null < "$f"
  fi
  echo "$1=$2" >> "$tmp"
  mv -f "$tmp" "$f"
  chmod 600 "$f" 2>/dev/null
}

cmdline_has() { tr '\0' ' ' < "/proc/$1/cmdline" 2>/dev/null | grep -qF -e "$2"; }
pid_alive() {  # $1 pid, $2 optional cmdline substring (PID-reuse guard)
  [ -n "$1" ] || return 1
  kill -0 "$1" 2>/dev/null || return 1
  [ -z "$2" ] && return 0
  cmdline_has "$1" "$2"
}

lock_acquire() {
  n=0
  while [ "$n" -lt 10 ]; do
    if mkdir "$STATE/lock" 2>/dev/null; then echo $$ > "$STATE/lock/pid"; return 0; fi
    lpid=$(cat "$STATE/lock/pid" 2>/dev/null)
    if [ -z "$lpid" ]; then
      # No pid yet: mkdir→pid-write is not atomic, so an empty pid must be
      # treated like a live holder (same rule as lock_live) — never steal.
      sleep 1; n=$((n+1))
    elif pid_alive "$lpid" ""; then
      sleep 1; n=$((n+1))
    else
      rm -rf "$STATE/lock"               # recorded pid is dead → stale lock
    fi
  done
  return 1
}
lock_release() { rm -rf "$STATE/lock"; }

lock_live() {  # rc 0 = lock present and held (skip); stale lock (dead pid) → cleared, rc 1.
  # A lock whose recorded pid is DEAD is stale → cleared here (a killed apply must
  # not wedge the keeper until reboot). A lock with no/unreadable pid is treated
  # as LIVE: mkdir→pid-write is not atomic, so "no pid yet" must not be mistaken
  # for stale (boot.sh clears any leftover lock after a reboot).
  [ -d "$STATE/lock" ] || return 1
  lpid=$(cat "$STATE/lock/pid" 2>/dev/null)
  if [ -n "$lpid" ] && ! pid_alive "$lpid" ""; then
    rm -rf "$STATE/lock"
    return 1
  fi
  return 0
}

ensure_state() {
  mkdir -p "$STATE" 2>/dev/null
  # F2/T8: STATE is traverse-only for others (0711). The bundled dnscrypt-proxy
  # re-execs itself as user_name='nobody' with CWD = this dir; its startup
  # os.Getwd() resolves "." through the kernel's may_lookup, which requires
  # ONLY search (x) here — read (r) would expose directory listings and is not
  # needed. Private files stay 0600; the filter-facing files are relaxed by
  # filter_perms (each mode's reason is documented there).
  chmod 711 "$STATE" 2>/dev/null
  # journal/keeper/guard logs are created by >> redirects (umask → 0644 on a
  # fresh root shell) AFTER the glob below: pre-create them so the 0600 pass
  # holds from the very first write, not just from the next ensure_state pass.
  [ -e "$STATE/journal.log" ] || : >> "$STATE/journal.log" 2>/dev/null
  [ -e "$STATE/keeper.log" ] || : >> "$STATE/keeper.log" 2>/dev/null
  [ -e "$STATE/guard.log" ] || : >> "$STATE/guard.log" 2>/dev/null
  chmod 600 "$STATE"/state "$STATE"/state.tmp "$STATE"/*.log* 2>/dev/null
  filter_perms
}

# --- filter-facing modes (F2, T8 finding) ------------------------------------
# Exactly what the uid99 filter child needs — verified against dnscrypt-proxy
# 2.1.18 (main() os.Getwd -> stat("."); dlog opens/truncates log_file; the
# blocked-names logger appends) and Linux namei semantics (may_lookup: x only):
#   x on $STATE: getwd + path resolution when the binary re-execs as nobody
#   r on the three inputs: toml, forwarding rules, blocked-names list
#   w on the two log files: filter.log, blocked-names.log — pre-created because
#     $STATE is (deliberately) not writable by uid99. Both are non-sensitive
#     diagnostics; a chown-based tightening needs chown availability proof (S4).
# Everything else is 0600 via the ensure_state pass above (state, journal and
# the pre-created keeper/guard logs). The pid files (filter/keeper/guard.pid)
# and lock/ + lock/pid are never chmodded (created under root's umask) —
# harmless: PIDs are non-sensitive, $STATE is 0711 (not listable), uid99 cannot
# write here.
filter_perms() {
  chmod 644 "$STATE"/dnscrypt-proxy.toml "$STATE"/forward-rules.txt "$STATE"/filter-input.txt 2>/dev/null
  for f in "$STATE"/filter.log "$STATE"/blocked-names.log; do
    [ -e "$f" ] || : >> "$f" 2>/dev/null
    chmod 666 "$f" 2>/dev/null
  done
}

cap_probe() {
  CAP=unsupported
  command -v iptables >/dev/null 2>&1 || return 0
  iptables -t nat -S >/dev/null 2>&1 || return 0
  # Targets list: /proc/net/ip_tables_targets on a real kernel; test-only override
  # (LGTVB_TARGETS_FILE) because sandboxes (Git Bash) have no ip_tables proc entry.
  tg=${LGTVB_TARGETS_FILE:-/proc/net/ip_tables_targets}
  if [ -r "$tg" ] && grep -qx DNAT "$tg"; then
    CAP=dnat
  else
    CAP=none
  fi
}

is_ipv4() { echo "$1" | grep -Eq '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'; }

upstream_learn() {
  # Read dns1 from connectionmanager. NO -f: on G1, -f pretty-prints the JSON
  # (`"dns1": "…"`), which broke the original space-intolerant sed (T8 F1).
  # The parse tolerates compact AND pretty output (belt+braces): any whitespace
  # around the colon is allowed.
  up=$(luna-send -n 1 luna://com.webos.service.connectionmanager/getStatus '{}' 2>/dev/null | sed -n 's/.*"dns1"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  if is_ipv4 "$up"; then echo "$up"; else echo ""; fi
}

dnsq() {
  if [ -n "$LGTVB_DNSQ" ]; then "$LGTVB_DNSQ" "$@"; else "$SELF_DIR/dnsq.sh" "$@"; fi
}
canary_sideport() {
  n=0
  while [ "$n" -lt 3 ]; do
    dnsq example.com 127.0.0.1 "$FILTER_PORT" >/dev/null 2>&1 && return 0
    n=$((n+1)); sleep 1
  done
  return 1
}
canary_system() { dnsq example.com >/dev/null 2>&1; }
canary_upstream() { dnsq example.com "$1" >/dev/null 2>&1; }
blocked_name() { grep -m1 '^=' "$STATE/filter-input.txt" 2>/dev/null | cut -c2-; }
canary_blocked() {  # system path (through DNAT); expect rcode!=0 (REFUSED) → rc 2
  name=$(blocked_name)
  [ -n "$name" ] || return 1
  dnsq "$name" >/dev/null 2>&1
  rc=$?
  [ "$rc" -eq 2 ]
}

# Active tier: 'safe' | 'strict'. One state lookup, normalized here so every
# reader (materialize, check.sh) agrees on the value and on the default.
tier_get() {
  tg_v=$(state_get tier 2>/dev/null)
  case $tg_v in
    safe|strict) printf '%s\n' "$tg_v" ;;
    *) printf '%s\n' "$TIER_DEFAULT" ;;
  esac
}

# The preset list for a tier. A bundle older than tiers has no
# filter-input-<tier>.txt; that is not a failure — it is the pre-tier snapshot
# (the strict list), which is what such a bundle shipped and what its scripts
# blocked with. Logged once per materialize so the discrepancy is visible in
# the journal instead of silent.
tier_list() {
  tl_f="$APP_DIR/filter/filter-input-$1.txt"
  if [ ! -f "$tl_f" ]; then
    log "materialize-fallback reason=no-tier-file tier=$1"
    tl_f="$FILTER_INPUT_SRC"
  fi
  printf '%s\n' "$tl_f"
}

# --- overrides (S6a T2 seam; the writer lands in S6b) ------------------------
# $STATE/overrides.txt holds one line per domain, keyed by NAME (never by
# position, so it survives a list update):
#   +name   force the exact rule '=name' into the effective list
#   -name   remove whichever entry matches: the exact rule '=name' or the bare
#           zone anchor 'name'
# Applied AFTER the preset list is copied, so the preset stays the baseline.
# An absent or empty file is a no-op. Lines that are neither form, or whose
# name carries a character outside [a-z0-9._-], are IGNORED, never
# interpreted: grep takes the name as a fixed string (-F -x), so no override
# line can ever act as a pattern, and this reader tolerates a file it did not
# write (the writer re-validates the payload before writing, D13a).
overrides_apply() {  # $1 list file (modified in place), $2 overrides file
  oa_ov=$2
  [ -f "$oa_ov" ] || return 0
  while IFS= read -r oa_line; do
    case $oa_line in
      +*) oa_op=add; oa_name=${oa_line#+} ;;
      -*) oa_op=del; oa_name=${oa_line#-} ;;
      *) continue ;;
    esac
    [ -n "$oa_name" ] || continue
    case $oa_name in
      *[!a-z0-9._-]*) continue ;;
    esac
    if [ "$oa_op" = add ]; then
      # Already an exact rule → nothing to do. A bare zone anchor for the same
      # name is NOT counted: the plan's override line means the exact entry, and
      # keeping that literal makes the effective set predictable.
      grep -F -x -q "=$oa_name" "$1" 2>/dev/null && continue
      printf '=%s\n' "$oa_name" >> "$1" || return 1
    else
      grep -F -x -v -e "=$oa_name" -e "$oa_name" "$1" > "$1.ovtmp" 2>/dev/null
      oa_rc=$?
      # 0 = removed something, 1 = nothing matched (still a valid empty/no-op
      # result); anything else is a real grep error and must not truncate the
      # list it just read.
      [ "$oa_rc" -le 1 ] || { rm -f "$1.ovtmp"; return 1; }
      mv -f "$1.ovtmp" "$1" || return 1
    fi
  done < "$oa_ov"
  return 0
}

materialize_config() {
  up=$1
  if [ -z "$up" ] || ! is_ipv4 "$up"; then
    log "materialize-fail reason=no-upstream"
    return 1
  fi
  # B-budget/T8: a missing binary can never be fixed by retrying — fail fast
  # (apply reports fail/materialize; the keeper has its own earlier fast path).
  if [ ! -f "$FILTER_BIN" ]; then
    log "materialize-fail reason=binary-missing"
    return 1
  fi
  sed "s|@STATE@|$STATE|g" "$FILTER_TOML_TMPL" > "$STATE/dnscrypt-proxy.toml" || return 1
  sed "s|@UPSTREAM@|$up|g" "$FORWARD_TMPL" > "$STATE/forward-rules.txt" || return 1
  # S6a T2: the ACTIVE TIER's preset list, then the overrides on top. The file
  # this writes keeps the exact pre-tier on-disk format (one dnscrypt-proxy
  # blocked_names entry per line: '=name' exact, bare name whole-zone).
  mt_list=$(tier_list "$(tier_get)")
  cp -f "$mt_list" "$STATE/filter-input.txt" || return 1
  if ! overrides_apply "$STATE/filter-input.txt" "$STATE/overrides.txt"; then
    log "materialize-fail reason=overrides"
    return 1
  fi
  # Template drift (an unsubstituted token) would leave '@' in a rendered file and
  # the filter would never start; fail here with a clear reason (callers fail open).
  # Generic guard: no legitimate rendered content contains '@' (S4 T5 dropped the
  # dead [static] stamp — forwarding_rules carries all resolution).
  if grep -qF '@' "$STATE/dnscrypt-proxy.toml" 2>/dev/null || grep -qF '@' "$STATE/forward-rules.txt" 2>/dev/null; then
    log "materialize-fail reason=token-left"
    return 1
  fi
  # F2/T8: filter-facing modes live in filter_perms (the uid99 child must read
  # these; everything else in STATE stays root-only 0600).
  filter_perms
  chmod +x "$FILTER_BIN" 2>/dev/null
  return 0
}

filter_start() {
  filter_kill
  "$FILTER_BIN" -config "$STATE/dnscrypt-proxy.toml" >>"$STATE/filter.log" 2>&1 </dev/null &
  echo $! > "$STATE/filter.pid"
  sleep 2
}
filter_kill() {
  p=$(cat "$STATE/filter.pid" 2>/dev/null)
  if pid_alive "$p" dnscrypt; then kill -9 "$p" 2>/dev/null; fi
  rm -f "$STATE/filter.pid"
}
filter_running() { pid_alive "$(cat "$STATE/filter.pid" 2>/dev/null)" dnscrypt; }
# --- cheap liveness: pid + local listening port (no process spawn) ---
filter_alive_cheap() {
  filter_running || return 1
  hex=$(printf '%04X' "$FILTER_PORT" 2>/dev/null)
  [ -n "$hex" ] || return 1
  grep -q "0100007F:$hex 00000000:0000 0A" "${LGTVB_PROC_TCP:-/proc/net/tcp}" 2>/dev/null
}
keeper_running() { pid_alive "$(cat "$STATE/keeper.pid" 2>/dev/null)" keeper; }
guard_running()  { pid_alive "$(cat "$STATE/guard.pid" 2>/dev/null)" guard; }

ensure_supervisors() {
  keeper_running || { "$SELF_DIR/keeper.sh" >>"$STATE/keeper.log" 2>&1 </dev/null & }
  guard_running  || { "$SELF_DIR/guard.sh"  >>"$STATE/guard.log"  2>&1 </dev/null & }
}

rules_on() {  # $1 upstream; builds chain contents FIRST, jump LAST
  up=$1
  iptables -t nat -N "$RULES_NAT" 2>/dev/null
  iptables -t nat -F "$RULES_NAT"
  iptables -t nat -A "$RULES_NAT" ! -d "$up" -p udp --dport 53 -j DNAT --to-destination 127.0.0.1:$FILTER_PORT
  iptables -t nat -A "$RULES_NAT" ! -d "$up" -p tcp --dport 53 -j DNAT --to-destination 127.0.0.1:$FILTER_PORT
  iptables -t nat -C OUTPUT -j "$RULES_NAT" 2>/dev/null || iptables -t nat -I OUTPUT 1 -j "$RULES_NAT"
  iptables -N "$RULES_FLT" 2>/dev/null
  iptables -F "$RULES_FLT"
  iptables -A "$RULES_FLT" -p tcp --dport 853 -j DROP
  iptables -A "$RULES_FLT" -p udp --dport 853 -j DROP
  iptables -C OUTPUT -j "$RULES_FLT" 2>/dev/null || iptables -I OUTPUT 1 -j "$RULES_FLT"
}
rules_off() {  # resolver restored FIRST (jump removed = protection off instantly)
  if iptables -t nat -C OUTPUT -j "$RULES_NAT" 2>/dev/null; then
    iptables -t nat -D OUTPUT -j "$RULES_NAT"
    iptables -t nat -F "$RULES_NAT"
  fi
  if iptables -C OUTPUT -j "$RULES_FLT" 2>/dev/null; then
    iptables -D OUTPUT -j "$RULES_FLT"
    iptables -F "$RULES_FLT"
  fi
  iptables -t nat -X "$RULES_NAT" 2>/dev/null
  iptables -X "$RULES_FLT" 2>/dev/null
}
rules_present() {  # $1 upstream — all -C checks must pass
  up=$1
  iptables -t nat -C OUTPUT -j "$RULES_NAT" 2>/dev/null || return 1
  iptables -t nat -C "$RULES_NAT" ! -d "$up" -p udp --dport 53 -j DNAT --to-destination 127.0.0.1:$FILTER_PORT 2>/dev/null || return 1
  iptables -t nat -C "$RULES_NAT" ! -d "$up" -p tcp --dport 53 -j DNAT --to-destination 127.0.0.1:$FILTER_PORT 2>/dev/null || return 1
  iptables -C OUTPUT -j "$RULES_FLT" 2>/dev/null || return 1
  iptables -C "$RULES_FLT" -p tcp --dport 853 -j DROP 2>/dev/null || return 1
  iptables -C "$RULES_FLT" -p udp --dport 853 -j DROP 2>/dev/null || return 1
  return 0
}

# --- bounded rules verification (F3, T8 finding) -----------------------------
# rules_on + end-to-end verify with a bounded retry, so a TRANSIENT failure
# (xtables lock contention with another app, one DNS flake) does not immediately
# burn the terminal fail-open path. rules_on is re-run each attempt (idempotent)
# because a lock error can leave the chain half-built. Sets
# RULES_FAIL=rules|canary|blocked on final failure so callers keep their
# specific failure reasons.
rules_on_verified() {
  # T8 review nit: POSIX sh has no `local`; these used to shadow the shared
  # globals `up`/`r` (keeper.sh's restart loop uses `r` — the same sharing class
  # already caused one bug, keeper.sh:106-109). Prefixed names keep this
  # function's scratch state disjoint. Log format "n=$rr_r" is unchanged.
  rr_up=$1
  RULES_FAIL=""
  rr_r=0
  while [ "$rr_r" -lt "$RULES_RETRY" ]; do
    rr_r=$((rr_r+1))
    rules_on "$rr_up"
    if ! rules_present "$rr_up"; then
      RULES_FAIL=rules
    elif ! canary_system; then
      RULES_FAIL=canary
    elif ! canary_blocked; then
      RULES_FAIL=blocked
    else
      [ "$rr_r" -gt 1 ] && log "rules-retry-ok n=$rr_r"
      return 0
    fi
    [ "$rr_r" -lt "$RULES_RETRY" ] && sleep "$RULES_RETRY_SLEEP"
  done
  return 1
}

fail_open_terminal() {  # $1 = reason; terminal give-up: protection OFF, TV works
  rules_off
  filter_kill
  # Marker BEFORE pointer=off: any reader that sees the off state also sees the
  # attention flag (check.sh reads the two independently; no window with
  # pointer=off + gaveup=no). apply.sh clears it after pointer=on.
  : > "$STATE/gaveup"
  state_set pointer off
  log "terminal-giveup reason=$1"
}
