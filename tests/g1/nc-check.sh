#!/bin/sh
# nc-check.sh — verify busybox od/nc capabilities + the node-hidden fallback path.
APP=/media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist
echo "nc=$(command -v nc || echo none) od=$(command -v od || echo none)"
echo "== fallback live test (node hidden from PATH) =="
d=$(dirname "$(command -v node 2>/dev/null || echo /nonexistent)") 2>/dev/null
PATH="/nonexistent:$d-nowhere:/bin:/usr/bin:/sbin:/usr/sbin" sh "$APP/scripts/dnsq.sh" example.com 127.0.0.1 5335
echo "rc=$?"
