# S4 hardware test - G1 keeper/boot proofs and the T9 supervised live window

> Recorded 2026-10-05. Everything below is **host-supervised on-device evidence**: a host
> machine drives the real TV over SSH and runs a host-side watchdog around the on-device
> components. There is no lab simulation and no fake or inferred line - each value cites the
> file it comes from. The S4 keeper/boot proofs and the T9 live window share one raw evidence
> directory (see Reproduce). Values that could not be observed on-device are marked
> **NOT REPORTED** / **UNVERIFIED** rather than guessed.

## 1. Scope and environment

- **Device class:** LG G1 OLED webOS TV (OLED55G19LA class), rooted via the Homebrew Channel
  (HBC), running app **0.4.2** (`app-version.txt` = `0.4.2`).
- **Two operating modes** (both used below):
  - **Mode A (default):** `blocked_query_response = 'refused'` - a blocked name returns REFUSED.
  - **Mode B (test-only):** `blocked_query_response = 'a:0.0.0.0,aaaa::'` - a blocked name returns
    `0.0.0.0`. Keeper/apply must not be live under mode B; T9 drives mode B with supervision off.
- **On-device components:** device-local DNS filter (dnscrypt-proxy), a **keeper** supervisor, a
  **guard** watchdog, and an autorestore **deadman** timer. The T9 window isolates the filter by
  stopping the supervisors.
- **Roles:** the host orchestrates and captures; the TV executes. Addresses for this window:
  TV `192.168.178.45`, upstream DNS `192.168.178.1` (`status-before.txt`, `00-verdict.txt`).
- **Nature of the evidence:** this is measured behaviour of the shipped app on the real device
  under host supervision, not a unit test or a simulation.

## 2. S4 keeper/boot proofs

The app's own journal (`journal.log`, copied in the evidence dir) plus the window captures record
the keeper set. Each proof names its evidence file.

| Proof | Observed value | Evidence file |
|---|---|---|
| Keeper liveness | `KEEPER-OK pid=29715 cmd=/bin/sh .../scripts/keeper.sh`; status `keeper=up` | `keeper-kill.txt`, `status-before.txt` |
| Guard liveness and fire | converge `t=0 guard=up`, `t=1 guard=up`, `t=2 guard=down`; journal `guard-fired keeper-dead` | `deadman-converge.txt`, `journal.log` |
| Terminal give-up on keeper death | `t=2 keeper=down guard=down gaveup=yes mode=off`; journal `2026-10-05 12:50:06 terminal-giveup reason=keeper-dead`; independent scan shows `guard GONE` / `keeper GONE` / `filter GONE` | `deadman-converge.txt`, `journal.log`, `stopped-supervisors.txt` |
| Boot persistence | `2026-10-02 10:52:36 boot-start pid=3560` -> `boot pointer=on` -> `boot-reconcile pointer=on delegated=keeper` -> `boot-supervisors-started`; `keeper-filter-dead restore-first` then `keeper-restart n=1` and `keeper-recovered` at `10:52:51` | `journal.log` |
| Recovery path | rollback `RESULT=off reason=user-off` -> apply `RESULT=on reason=verified upstream=192.168.178.1`; toml `R3-MD5-EQUAL`; then `mode=on filter=up rule=on keeper=up guard=up pointer=on gaveup=no` | `revert-rollback.txt`, `revert-apply.txt`, `revert-md5.txt`, `modeA-assert.txt` |

Notes:

- **Boot persistence** is the overnight power-off case: the TV was off, booted at `2026-10-02
  10:52:36`, the boot reconciler saw the pointer `on` and delegated to the keeper, which restarted
  the dead filter and self-recovered within ~15 s (`10:52:36` -> `10:52:51`). The boot hook symlink
  persists across boot: `hook=linked` with target `.../scripts/boot.sh` in both `status-before.txt`
  and `status-after.txt`.
- **Terminal give-up is by design** (fail-open): once the keeper dies the guard fires and the
  system stays OFF until the owner re-applies. That is the intended safety direction, not a bug.
- The `R3-MD5-EQUAL` / `R5-MD5-EQUAL` restore checks confirm mode A's toml (line 11
  `blocked_query_response = 'refused'`) and the parsed status returned to the pre-window values.

## 3. The T9 supervised live window (attempt 3, 2026-10-05)

Window wall-clock **12:51:22 -> 12:57:28 = 366 s** (`window-log.txt`, `02-timings.txt`). Full run
step 0 to teardown = 536 s (`12:49:39` -> `12:58:35`). The verdict file's first line is
`T9-WINDOW-PASS`, verified host-side with `head -1 00-verdict.txt` (`00-verdict.txt`).

| AC | Result | Measured value / evidence |
|---|---|---|
| **AC1** preconditions | PASS | `AC1-PRECONDITIONS-OK` (all 8 keys); `status-before.txt` `mode=on filter=up rule=on keeper=up guard=up pointer=on gaveup=no upstream=192.168.178.1 cap=dnat` |
| **AC2** keeper death -> deadman | PASS | `keeper-kill.txt` `KEEPER-OK pid=29715`; `deadman-converge.txt` last line `t=2 keeper=down guard=down gaveup=yes mode=off`; `journal.log` `guard-fired keeper-dead` + `terminal-giveup reason=keeper-dead` at `12:50:06`; `stopped-supervisors.txt` independent scan `real-supervisor-count=0` and `filter GONE`; the filter itself stayed up |
| **AC3** mode B live, supervision off | PASS | `modeB-delta.txt` one-line change line 11 `refused` -> `a:0.0.0.0,aaaa::`; `live-modeB.md5` = `47c5d204af47d4a11703065dc92da354` equal local and TV; `engage-once.txt` `ENGAGE-OK upstream=192.168.178.1`; **all 12/12** in-window samples `rule=on filter=up keeper=down guard=down toml=47c5d204af47d4a11703065dc92da354 ran=no`; mid-window re-read md5 unchanged |
| **AC4** canary / owner perception | PASS (canary) / **NOT REPORTED** (owner) | `window-log.txt` `12:51:23` and `12:53:55` canary `a.lgappstv.com` returned `Address: 0.0.0.0` on both `127.0.0.1:5335` and `127.0.0.1:53` (rc=0), 4x `Address: 0.0.0.0`, **0 mismatches**; control `example.com` returned real answers (`172.66.147.243` / `104.20.23.154`). Third independent record: the TV app's own `blocked-names.log` line `[2026-10-05 12:53:55] 127.0.0.1 a.lgappstv.com a.lgappstv.com`. Owner half NOT REPORTED (see Limitations) |
| **AC5** revert / recovery pair | PASS | `revert-rollback.txt` `RESULT=off reason=user-off` -> `revert-apply.txt` `RESULT=on reason=verified upstream=192.168.178.1` (first try, no retry); `revert-md5.txt` `R3-MD5-EQUAL`; `modeA-assert.txt` `REFUSED` on the canary, no `0.0.0.0`, real `example.com`, status `mode=on filter=up rule=on keeper=up guard=up pointer=on gaveup=no` |
| **AC6** evidence capture | PASS | **50 files**, 232 KB in the evidence dir, incl. `journal.log` (21851 B), `filter.log`, `blocked-names.log`, `window-log.txt`, `status-before/after.txt`, `modeA-assert.txt`, `modeB-assert.txt`, `deadman-converge.txt`, `stopped-supervisors.txt`, `autorestore-*`, `live-modeB*` |

Additional in-window facts:

- **Deadman timer margin:** armed `12:50:48`, cancelled `12:58:05` -> **437 s used of the 900 s
  budget** (463 s / 51% margin) with **0 fires**; `autorestore-check.txt` is 0 bytes (no fire) and
  all 12 samples show `ran=no` (`02-timings.txt`, `autorestore-check.txt`, `window-log.txt`).
- **Filter restarts in-window: 0.** No restart/apply lines appear in `journal.log` between the
  engage (`10:38:43` keeper/guard start, filter engaged at `12:51:14`) and the revert
  (`12:58:05`); all 12 samples stayed `filter=up ran=no`.
- The window ran with **zero** `WATCHDOG-MISMATCH`, zero `WATCHDOG-AUTORESTORE-FIRED`, zero
  `autorestore.ran` (`00-verdict.txt`).
- Non-blocking executor error recorded in `00-verdict.txt`: the section-8 teardown block ran at
  `12:58:35` instead of after the section-7 copy (a fenced-block extraction mis-index). The
  section-7 scp capture had already completed and the durable copy was re-run, so no evidence was
  lost; mode A plus keeper/guard/filter were re-verified healthy afterwards.

## 4. LIMITATIONS

1. **AC4's owner-perception half was NOT REPORTED.** The window proves the objective canary result
   only. The owner was asked (twice) whether a stream stutter or failed start occurred during
   `12:51:22-12:57:28` and did not answer; `window-log.txt` records
   `owner-attestation: PENDING - NOT captured by the executor`. AC4 therefore stands on the canary
   and `blocked-names.log` records alone. If the owner later reports a stutter/failed start in that
   span, AC4's owner half flips to FAIL.
2. **The mode-B filter's own log cannot prove the window after the fact.** `filter.log`'s earliest
   line is `12:58:07`, i.e. after the restore restarted the filter; the restart overwrote the
   in-window log. The window is proven by the host-side canary, the 12/12 watchdog samples and the
   app's `blocked-names.log`, not by `filter.log`.
3. **A manually engaged deadman leaves no journal entry.** The mode-B window was engaged manually
   (supervision stopped, `engage-once`); `journal.log` has no app-journal line for
   `12:51:22-12:57:28` - the app logged the automatic deadman and the revert, nothing for the
   manual window. Product gap, recorded for the status/logging honesty pass.
4. **HBC `child_process.exec` transport under the real APP_DIR is UNVERIFIED on-device.** The
   on-device proofs above use direct script execution; the app's own HBC exec path against the real
   application directory has not been exercised end to end.
5. **dnscrypt-proxy reload behaviour for an emptied `blocked_names` is UNVERIFIED.** What the filter
   does if handed an empty blocking list was not tested. This is moot for safety: the materialize
   seam now refuses an empty list, so that state cannot be produced.

## 5. Reproduce

- **Runbook:** `/home/macmini/pi-agent/docs/plans/2026-10-05-lg-tv-app-t9-runbook.md`,
  **rev 13**, 96655 bytes, md5 `8f8c5f2a6dc1c48ccc694e46738fdc11` (unchanged before/after the run).
- **Raw evidence dir:** `/home/macmini/oc-work/t9-2026-10-05-r6-live/` (50 files, 232 KB).
  Verify the outcome with a single line:
  `head -1 /home/macmini/oc-work/t9-2026-10-05-r6-live/00-verdict.txt` -> `T9-WINDOW-PASS`.
- Earlier attempts and preflights live in the sibling dirs `/home/macmini/oc-work/t9-2026-10-05/`
  (attempt 1), `t9-2026-10-05-r2/` (attempt 2), `t9-2026-10-05-r3-preflight/`,
  `t9-2026-10-05-r3-mechprobe/`, `t9-2026-10-05-r4-preflight/`, `t9-2026-10-05-r5-loadprobe/`.
- **Known runbook defects (not affecting the outcome):** rev 13's teardown kills only the pid in
  `/tmp/t9/autorestore.pid`, so the wrapper's `sleep 900` child can survive as an orphan and
  match the runbook's own `sleep 900` timer marker on a later scan; and rev 13's fenced-block
  extraction can select section 7's durable-copy block instead of section 8's teardown block. Both
  are to be fixed in rev 14. Neither changed any measured result in this window.
