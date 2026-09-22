#!/bin/sh
# common.sh — shared helpers for the app's TV-side scripts. Sourced, never executed.
# Busybox ash compatible (LG G1, webOS 6). Test-only overrides:
# LGTVB_STATE_DIR, LGTVB_FILTER_BIN, LGTVB_DNSQ, LGTVB_TICK, LGTVB_GUARD_TICK,
# LGTVB_BACKOFF, LGTVB_UWAIT_ROUNDS, LGTVB_UWAIT_SLEEP, LGTVB_GUARD_GRACE,
# LGTVB_HOOK_DIR, LGTVB_TARGETS_FILE.
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
FILTER_PORT=5335
RULES_NAT=LGTVBLK
RULES_FLT=LGTVBLK-FILTER
TICK=${LGTVB_TICK:-5}
GUARD_TICK=${LGTVB_GUARD_TICK:-10}
BACKOFF=${LGTVB_BACKOFF:-4}
UWAIT_ROUNDS=${LGTVB_UWAIT_ROUNDS:-12}
UWAIT_SLEEP=${LGTVB_UWAIT_SLEEP:-10}
GUARD_GRACE=${LGTVB_GUARD_GRACE:-6}
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
state_set() {
  f="$STATE/state"; tmp="$STATE/state.tmp"
  if [ -f "$f" ]; then grep -v "^$1=" "$f" > "$tmp"; else : > "$tmp"; fi
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
    if pid_alive "$lpid" ""; then sleep 1; n=$((n+1)); else rm -rf "$STATE/lock"; fi
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
  chmod 700 "$STATE" 2>/dev/null
  chmod 600 "$STATE"/state "$STATE"/state.tmp "$STATE"/*.log* 2>/dev/null
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
  # Read dns1 from connectionmanager — exact command + parse ported from
  # C:\wezterm_temp\opencode\app-s0\g1\filter-apply.sh + upstream-probe.sh (READ THEM).
  up=$(luna-send -n 1 -f luna://com.webos.service.connectionmanager/getStatus '{}' 2>/dev/null | sed -n 's/.*"dns1":"\([^"]*\)".*/\1/p')
  if is_ipv4 "$up"; then echo "$up"; else echo ""; fi
}

dnsq() {
  if [ -n "$LGTVB_DNSQ" ]; then "$LGTVB_DNSQ" "$@"; else node "$SELF_DIR/dnsq.js" "$@"; fi
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

# --- upstream stamp: dnscrypt-proxy [static] entry for the runtime upstream ---
# dnscrypt-proxy requires a stamp for its [static] server even though
# forwarding_rules route every query to the learned upstream; a hardcoded stamp
# would bake one network's private IP into the shipped template. Plain-DNS stamp
# bytes: 0x00 (plain DNS) | props (8x 0x00) | len(addr) | addr, base64url, no
# padding. The 9 leading zero bytes are a multiple of 3, so they always encode
# to the fixed 'AAAAAAAAAAAA' prefix and only the length-prefixed address needs
# encoding. Pure POSIX shell: node and base64(1) are not POSIX tools.
B64URL=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_
b64char() { printf '%s' "$B64URL" | cut -c $(($1 + 1)); }

dns_stamp_upstream() {  # $1 IPv4 → plain-DNS stamp for <ip>:53; rc 1 on invalid input
  is_ipv4 "$1" || return 1
  addr="$1:53"
  set -- "${#addr}"                       # byte 0: LP length
  rest="$addr"
  while [ -n "$rest" ]; do                # then the ASCII address bytes
    c=$(printf '%.1s' "$rest")
    case $c in
      0) v=48 ;; 1) v=49 ;; 2) v=50 ;; 3) v=51 ;; 4) v=52 ;;
      5) v=53 ;; 6) v=54 ;; 7) v=55 ;; 8) v=56 ;; 9) v=57 ;;
      .) v=46 ;; :) v=58 ;;
      *) return 1 ;;
    esac
    set -- "$@" "$v"
    rest=${rest#?}
  done
  out=""
  while [ $# -gt 0 ]; do                  # base64url: 3 bytes → 4 chars, no padding
    if [ $# -ge 3 ]; then
      b1=$1; b2=$2; b3=$3; shift 3
      out="$out$(b64char $((b1 >> 2)))$(b64char $((((b1 & 3) << 4) | (b2 >> 4))))$(b64char $((((b2 & 15) << 2) | (b3 >> 6))))$(b64char $((b3 & 63)))"
    elif [ $# -eq 2 ]; then
      b1=$1; b2=$2; shift 2
      out="$out$(b64char $((b1 >> 2)))$(b64char $((((b1 & 3) << 4) | (b2 >> 4))))$(b64char $(((b2 & 15) << 2)))"
    else
      b1=$1; shift
      out="$out$(b64char $((b1 >> 2)))$(b64char $(((b1 & 3) << 4)))"
    fi
  done
  printf 'sdns://AAAAAAAAAAAA%s' "$out"
}

materialize_config() {
  up=$1
  if [ -z "$up" ] || ! is_ipv4 "$up"; then
    log "materialize-fail reason=no-upstream"
    return 1
  fi
  stamp=$(dns_stamp_upstream "$up")
  if [ -z "$stamp" ]; then
    log "materialize-fail reason=stamp"
    return 1
  fi
  sed "s|@STATE@|$STATE|g; s|@STAMP@|$stamp|g" "$FILTER_TOML_TMPL" > "$STATE/dnscrypt-proxy.toml" || return 1
  sed "s|@UPSTREAM@|$up|g" "$FORWARD_TMPL" > "$STATE/forward-rules.txt" || return 1
  cp -f "$FILTER_INPUT_SRC" "$STATE/filter-input.txt" || return 1
  # Template drift (token removed/renamed) would leave @STAMP@ in the config and
  # the filter would never start; fail here with a clear reason (callers fail open).
  if grep -q '@STAMP@' "$STATE/dnscrypt-proxy.toml" 2>/dev/null; then
    log "materialize-fail reason=stamp-token"
    return 1
  fi
  chmod 600 "$STATE/dnscrypt-proxy.toml" "$STATE/forward-rules.txt" "$STATE/filter-input.txt" 2>/dev/null
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
