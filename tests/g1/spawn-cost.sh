#!/bin/sh
# spawn-cost.sh [N] — coarse per-spawn dnsq cost (1 s clock resolution; use N>=20).
APP=/media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist
N="${1:-20}"; i=0; t0=$(date +%s)
while [ "$i" -lt "$N" ]; do node "$APP/scripts/dnsq.js" example.com 127.0.0.1 5335 >/dev/null 2>&1; i=$((i+1)); done
t1=$(date +%s)
echo "spawns=$N total_s=$((t1 - t0)) avg_ms=$(( (t1 - t0) * 1000 / N )) note=1s-clock"
