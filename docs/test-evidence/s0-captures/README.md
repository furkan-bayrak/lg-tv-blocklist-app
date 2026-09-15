# S0 spike evidence — curated captures

Curated capture set from the S0 validation spike on the G1 ("SlopBro", webOS 6.5.3), 2026-09-15.
Read together with the report: [`../s0-g1-spike-report.md`](../s0-g1-spike-report.md).

## Contents

- `capture-g1.md` — master capture log, Blocks 0–12: every entry with command → raw output →
  criteria → verdict. This doubles as the index for the S0 session.
- `b12-residue-verify.txt` — cleanup residue check against the Task 5 baseline (hooks + md5s,
  iptables both tables, mounts, no s0 dir).
- `b12-final-state.txt` — post-cleanup final state: stock hooks/rules/mounts restored, no harness
  processes left, functional re-verify OK.

## Full raw evidence

The full raw evidence set — all `captures\b10-*` / `b11-*` files, the TV-side probe snapshot
(`s0-probe-t15\`, 74 files), harness scripts, baselines, and candidate artifacts — remains in
scratch at `C:\wezterm_temp\opencode\app-s0\`, with `g1\capture-g1.md` as the index.
This repo intentionally keeps only the report, the master log, and the two cleanup proofs.
