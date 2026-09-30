# tests/g1 — S4 on-device harness (TV-only, NOT run in CI)

Proof harness for the keeper + fail-open deadman + boot reconciler mitigation set
(S4). These scripts run **on the rooted G1** against the installed app
(`/media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist`)
and its STATE dir (`/var/lib/webosbrew/lg-tv-blocklist-app`). CI only
syntax-checks and shellchecks them (`.github/workflows/build.yml`).

> **Warning:** TV-only. Never run against a TV without the owner present and the
> TV idle. Session 1 (kill matrix) must not reboot the TV. All scenarios leave
> the TV's DNS resolution briefly impaired by design — that is the test.

## Files

| File | Purpose |
|---|---|
| `kill-matrix.sh <F\|K\|FK\|KF\|BOTH> [outdir]` | Kill scenario driver: kills the target(s), polls system DNS 1×/s, waits ≤90 s for terminal convergence via `check.sh`, prints a parsable `RESULT …` line. NEVER repairs externally. Exit 0 = scenario met its S4 criteria. |
| `run-all.sh [outdir]` | Runs F,K,FK,KF,BOTH with an `apply.sh` ON-restore between scenarios. Fails fast on restore failure. |
| `double-apply.sh [N] [outdir]` | N iterations of `apply` → `apply` → `check` (double-apply + status fidelity); asserts `RESULT=on` twice, `mode=on`, exactly one keeper and one guard. |
| `spawn-cost.sh [N]` | Coarse per-spawn `node dnsq.js` cost (1 s clock; use N≥20). |
| `nc-check.sh` | busybox `od`/`nc` availability + live node-hidden fallback probe of `dnsq.sh`. |
| `preflight.sh` | Read-only session snapshot: system, STATE, pids, journal, init.d md5s, iptables, `check.sh`, `/tmp/s4` staging scan. |

## Usage (on the TV)

1. Stage these scripts to `/tmp/s4/` (e.g. via `scp`), mirroring from the PC.
2. Run: `sh /tmp/s4/preflight.sh`
3. Kill matrix: `sh /tmp/s4/run-all.sh /tmp/s4-captures` (~10–20 min)
4. N-watch: `sh /tmp/s4/double-apply.sh 20 /tmp/s4-captures`
5. Measurements: `sh /tmp/s4/spawn-cost.sh 20` / `sh /tmp/s4/nc-check.sh`
6. Mirror `$OUT` to the PC, then `rm -rf /tmp/s4 /tmp/s4-captures`.

## Expected outcome table (S4 acceptance)

| Scenario | Kills | Pass criteria (terminal state) |
|---|---|---|
| F | filter | converge ≤60 s → `filter=up rule=on gaveup=no mode=on` (keeper self-heals) |
| K | keeper | converge ≤30 s → `gaveup=yes mode=off` (deadman terminal fail-open) |
| FK | filter+keeper | converge ≤60 s → `gaveup=yes mode=off`; no persistent mixed state |
| KF | keeper, then filter | converge ≤60 s → `gaveup=yes mode=off`; no persistent mixed state |
| BOTH | filter+keeper together | converge ≤60 s → `gaveup=yes mode=off`; guard-fired line in journal |

"Auto-recovery" = DNS/service working again within the bound **and** no mixed
state (rule off + filter down). The matrix never repairs externally: K/FK/KF/BOTH
stay OFF until the user re-enables (safety-first); F is the self-healing path.

## Captures

Everything lands in the outdir (default `/tmp/s4-captures`):
`matrix-summary.txt`, `matrix-<SCEN>.txt` (pre/post status), `dark-<SCEN>.timeline`
(1 s DNS OK/FAIL poll), `run-<SCEN>.log`, `double-apply.txt`.
Mirror to the PC **before** deleting `/tmp/s4*` at session end.

## Restore semantics

- `run-all.sh` re-applies (ON) between scenarios and sleeps `SPACING` (default 5 s).
- Every session must end with `check.sh` showing `mode=on` (or the owner's chosen
  state for the OFF-leg), then teardown removes `/tmp/s4*`.
- After a K/FK/KF/BOTH scenario the keeper's terminal give-up stands until the
  restore `apply.sh` — that is intended (deadman fail-open is terminal).
