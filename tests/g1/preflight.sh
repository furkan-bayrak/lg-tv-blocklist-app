#!/bin/sh
# preflight.sh — S4 pre/post-session snapshot (read-only).
APP=/media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist
S=/var/lib/webosbrew/lg-tv-blocklist-app
echo "=== PREFLIGHT $(date '+%Y-%m-%d %H:%M:%S') epoch=$(date +%s) ==="
echo "--- system ---"
uname -a; uptime; cat /proc/loadavg
free
echo "--- STATE ls -la ---"
ls -la "$S/"
echo "--- STATE state file ---"
cat "$S/state" 2>/dev/null
echo "--- STATE pids ---"
for f in filter.pid keeper.pid guard.pid; do printf '%s: %s\n' "$f" "$(cat "$S/$f" 2>/dev/null)"; done
echo "--- app processes ---"
ps w | grep -E 'dnscrypt|keeper|guard' | grep -v grep
echo "--- journal tail ---"
tail -n 15 "$S/journal.log" 2>/dev/null
echo "--- keeper env (PATH/LGTVB) ---"
kp=$(cat "$S/keeper.pid" 2>/dev/null)
if [ -n "$kp" ] && [ -d "/proc/$kp" ]; then tr '\0' '\n' < "/proc/$kp/environ" 2>/dev/null | grep -E '^(PATH|LGTVB)'; else echo "keeper not live"; fi
echo "--- init.d ---"
ls -la /var/lib/webosbrew/init.d/
echo "hook readlink: $(readlink /var/lib/webosbrew/init.d/50-lgtv-blocklist-app 2>/dev/null || echo MISSING)"
md5sum /var/lib/webosbrew/init.d/00-block-lg-hosts /var/lib/webosbrew/init.d/01-block-lan-discovery /var/lib/webosbrew/init.d/02-block-dns-egress /var/lib/webosbrew/init.d/03-block-lg-ip-egress /var/lib/webosbrew/init.d/04-sync-clock /var/lib/webosbrew/init.d/99-stop-services /var/lib/webosbrew/init.d/inputhook 2>/dev/null
echo "--- hosts canary ---"
md5sum /etc/hosts
echo "--- nat ---"
iptables -t nat -S
echo "--- nat OUTPUT line-numbers ---"
iptables -t nat -L OUTPUT -v -n --line-numbers
echo "--- nat LGTVBLK ---"
iptables -t nat -L LGTVBLK -v -n 2>&1
echo "--- filter table ---"
iptables -S
echo "--- check.sh ---"
sh "$APP/scripts/check.sh" 2>&1
echo "--- /tmp/s4 staging scan ---"
ls -d /tmp/s4 /tmp/s4-captures 2>/dev/null || echo "NO_STAGING"
grep -r "tmp/s4" /var/lib/webosbrew/init.d/ "$S/" "$APP/scripts/" 2>/dev/null || echo "NO_FILE_REFS"
echo "=== PREFLIGHT END ==="
