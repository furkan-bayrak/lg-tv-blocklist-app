# Continuation plan - finish T7 on real hardware before any new features

**Date:** 2026-10-09
**Status:** proposed, not started
**Supersedes nothing.** The S6 plan (`2026-10-05-s6-tiers-and-domain-toggles.md`) stays the
spec for what T7 *is*; this plan covers proving it and cleaning up around it.
**Source of the direction:** owner review of the 2026-10-09 status note (also filed in the
Obsidian vault as `IT Stuff/LG/LG TV App - Status 2026-10-09.md`).

---

## 1. Where the project actually stands

The app is feature-complete for the S6 tier model and the domain-list UI, reviewed and pushed
(`main` = `1391c3c`, `e16546a..1391c3c`, 10 commits). Nothing is uncommitted, nothing is
unpublished.

What that work did **not** buy us is confidence on the television. The TV was off when the
segment ended, so every device-facing claim about the new UI is currently an inference from
host tests. That is the bottleneck this plan removes.

| Evidence class | State |
| --- | --- |
| TypeScript suite | 213 tests / 212 pass / 0 fail / 1 pre-existing skip (re-run 2026-10-09 on the frozen tree) |
| ES5 + node-8 checks | green |
| Shell suite | 511 pass / 3 fail - the three failures are pre-existing `dnsq nc` fixture cases |
| Host gates (build + checks + TS) | green through the segment |
| **Real-device behaviour of T7** | **NOT PROVEN** - the TV was off at close-out |
| HBC transport under the real APP_DIR | never exercised on hardware |

**The single rule that follows from this:** until the device checks below are green, T7 is
"shipped" but not "verified", and no new feature work starts on top of an unverified UI.

## 2. Scope

### In scope
- Real-device validation of the T7 domain-override path (P0).
- Root-causing the three `dnsq nc` shell failures (P0).
- Hardening: hardcoded TV addresses, file-operation locking/atomicity, evidence handling (P1).
- Making the non-sensitive development documentation survive the Mac mini (P1).
- Resuming feature work only after the above (P2).

### Out of scope (explicitly)
- New features, refactors or "while we are in there" cleanups before the device checks pass.
- Changes to LG/HBC preferences. The app informs about firmware/OTA blocking; it never writes
  firmware or OTA settings, and nothing in this plan changes that.
- Any change to the Mac mini's load-bearing services (AdGuard Home, sitequota, musicbox).
- Force-pushing, amending or rebasing published commits.
- Rewriting the historical LAN details already committed in `docs/test-evidence/s0-captures/`
  and the other evidence docs - that is the owner's call, recorded in section 6, not a
  unilateral cleanup.

### Safety constraints (hard)
1. **Preserve TV settings.** Nothing outside the app's own files changes on the device.
2. **Stop and report** if a test could disrupt the working DNS configuration or the TV's LAN
   reachability. Do not "just try one more thing" on a device that is mid-flight.
3. **One writer on the TV at a time**, and one writer per repository at a time.
4. **`tests/g1/**` stays frozen**, and the T9 runbook is not rewritten during a device window.
5. **No secrets in anything committed** (credentials, tokens, device secrets, raw device logs
   that contain them).

## 3. Workstreams

### A - P0: real-device T7 validation (owner: Pi orchestrator on the Mac mini)

The full checklist, the exact commands and the PASS/FAIL/UNVERIFIED protocol are in
section 5. Summary of what must be proven:

| # | Check | Pass criterion |
| --- | --- | --- |
| A1 | Reachability | TV reachable at its **current** address; the address is read from the ops doc, not assumed |
| A2 | Leftover cleanup | no stale test processes or scratch files remain; every kill is justified by a verified full command line first |
| A3 | Apply + exact read-back | after one Apply of N staged changes (>= 3, including one removal), `overrides.sh list` returns exactly the staged effective set, in metadata order, and the reported `entries=` matches |
| A4 | Restart semantics | the filter restart happens once, the DNS gap is short and recorded, and DNS works again afterwards |
| A5 | SAFE zone anchor | under SAFE an anchor forced on materialises as the **single apex** rule - a subdomain probe of that anchor is **not** blocked; under STRICT the same anchor **does** block the subtree |
| A6 | Webview behaviour | the four outstanding UI checks are observed and described (focused-row scrolling inside the 60vh list, Enter activating a focused row button, border/focus-ring legibility on the panel, the closed Reset dialog staying out of the focus order) |
| A7 | HBC transport | one Apply through the Homebrew Channel bridge under the **real** APP_DIR path (not the test double) |
| A8 | Clean state | the TV ends with protection ON, no scratch left behind, and no setting altered outside the app's own files |

### B - P0: the three failing shell tests (owner: GitHub-side collaborator)

`tests/shell/run-tests.sh` fails three cases in the `dnsq nc` fixture set (REFUSED response,
empty response, short response). These were failing before the T7 work started, so they are
not a regression - but a suite with permanent red trains everyone to ignore red.

- Decide first whether each failure is a **test-environment problem** (fixture/stub drift,
  missing `nc` variant, timing) or an **application bug** (the seam mishandling a real
  response shape). The three cases must be classified individually, not as a group.
- Deliverable: a PR that either fixes the fixtures/stubs with a note explaining the
  environment cause, or fixes the application code with a regression test.
- Acceptance: the shell suite is fully green on a clean checkout, and the classification of
  each of the three cases is written down. "Deleted the failing test" is not an acceptable
  resolution for any of them.
- Note: this collaborator work must not modify `app/scripts/**` while a device window is open
  (see the freeze rule in section 4).

### C - P1: hardening (owners split; small, high-value)

| # | Item | Owner | Note |
| --- | --- | --- | --- |
| C1 | Stale TV address hardcoded in the T8/T9 scripts and docs (`192.168.179.8`) | orchestrator | read the current address from one place; fail loudly if unset rather than probing a stale default |
| C2 | `tier.sh` has no lock; concurrent runs can interleave | GitHub collaborator | add locking + a test |
| C3 | Non-atomic `cp -f` in the write path | GitHub collaborator | tmp + rename, same pattern the generator already uses |
| C4 | `tools/check-es5.mjs` wording + the rc-1 assertion; scan `names` unconditionally | GitHub collaborator | LOW polish carried from the S6 review |
| C5 | Local-only evidence: keep the raw dirs local, but record a manifest (paths, sizes, hashes) so the claim is reproducible | orchestrator | no raw logs into the public repo |

### D - P1: documentation durability (owner: orchestrator, with the owner deciding the target)

Today the session map and the T9 runbook exist **only on the Mac mini**, and the map is
gitignored where it lives (`~/pi-agent/.gitignore` line 11). If the machine dies, they are
gone; the archive entry and the repo survive. The recommendation is the obvious one: put
non-sensitive development documentation under version control, keep credentials, device
secrets and sensitive raw logs out.

Both repositories are **public**, and the existing committed evidence already contains LAN
addresses and local absolute paths (for example `docs/test-evidence/s0-captures/*` and
`docs/test-evidence/s4-g1-keeper-and-boot-proofs.md`). So the migration is a sanitize-then-commit
job, not a copy job:

1. **Classify** each artefact: publishable as-is / publishable after sanitizing / stays local.
   Credentials, device secrets, HBC specifics, raw `journal`/`dmesg` dumps and anything with
   a token stay local.
2. **Sanitize**: LAN addresses to placeholders, absolute host paths to generic forms, and any
   device-specific identifier removed. Line counts and outcomes are kept; raw bulk output is
   not.
3. **Commit** the sanitized session map and the runbook into the app repository (`docs/`)
   under a clear path, or - if the owner prefers keeping the home-network detail out of a
   public repo - into a private repository, with a pointer left in the public docs.
4. **Manifest** the local-only evidence (C5) so the local material is still citable.
5. **Verify no secrets** with a scan before the commit, and record the scan in the commit
   message or the evidence doc.

The owner decides step 3's target; the classification and sanitization work is mechanical.

### E - P2: resume feature development (owner: as decided later)

Only after A5/A6 are green. The backlog is unchanged: first-run setup, restore workflow and
list-update functionality. Each item gets its own plan before implementation.

## 4. Sequencing and parallel-safety

```
A (device validation, Mac) ------------> A6 green ---------> E (features)

B (shell test failures, GitHub) -------> green suite

C2/C3/C4 (hardening, GitHub branches) -> PRs -> merge after the device window

C1/C5 + D (docs / addresses, Mac) -----> commits
```

Rules that keep that picture honest:

- **A writes no repository content while it runs** (evidence goes to a local directory first).
  This is what lets B and the C2/C3/C4 branch work proceed in parallel without a race.
- **Script freeze:** `app/scripts/**` does not change while a device window is open. The TV
  executes those scripts; a push landing mid-run produces an unattributable result.
- **One writer per repo.** The collaborator works on branches and opens PRs; `main` stays
  green; no force-push, no amend, no rebase of published commits.
- The orchestrator's own docs/address commits land after the device run, so the evidence doc
  can cite the exact commit the TV was actually running (section 5, step 0).
- **Bounded device attempts** as in the previous runs: at most two bounded connection attempts
  per check; one power cycle no more often than roughly every four minutes; if a check fails
  twice, stop and report instead of hammering the device.

## 5. The device run, step by step (workstream A)

**Step 0 - record the baseline the TV is running.** Before touching the device, note the
repository commit (today: `1391c3c`) and the on-device script hashes. Every result is then
attributable to a known version.

**Step 1 - precondition and reachability.** Confirm the TV is powered on and reachable at its
**current** address, read from the ops document rather than remembered. The historical
addresses in the handovers are stale; do not trust them. If the device is unreachable, stop
here - there is nothing to test and no reason to power-cycle in a loop.

**Step 2 - leftover cleanup (verify before kill).** List candidate processes with their full
command lines and start times, and identify each one before acting. Known candidates from the
last segment: two hung TV shells (pids 11633 and 13137/13143) and the scratch directory
`/tmp/s6b-check/` on the device. Confirm each pid is really the hung shell and not a live
session, then terminate by exact pid - never by pattern. On the Mac mini side, a check on
2026-10-09 found no leftover local test processes, so this work is device-side only.

**Step 3 - apply and read back (A3/A4).** Stage at least three changes, including one removal,
apply once, then read the effective list back and compare it exactly against the staged set
and against the metadata order. Record the restart and the measured DNS gap.

**Step 4 - zone anchor semantics (A5).** Under SAFE, force one anchor on and verify the
materialised rule is the single apex: a subdomain probe of that anchor resolves/behaves
normally (not refused). Then confirm STRICT still blocks the subtree. This is the check that
validates the tier-aware copy the UI now promises.

**Step 5 - webview checks (A6).** Remote-driven, on the panel: focus scrolling inside the
60vh list, Enter activation on a row button, border/focus-ring legibility at panel distance,
and the closed Reset dialog not receiving focus. Describe what was seen; a screenshot or a
short note per item is enough.

**Step 6 - HBC transport (A7)**, if practical this round. One Apply through the Homebrew
Channel bridge using the real APP_DIR. If the window is too tight, record UNVERIFIED with the
reason - do not fake it.

**Step 7 - leave the device clean (A8).** Protection ON, no scratch files, no settings touched
outside the app's own files.

**Evidence rules for every step:** record the exact command and its raw output, and mark the
result **PASS**, **FAIL** or **UNVERIFIED** - never "probably fine". An unreachable device is
UNVERIFIED, not PASS. Evidence goes to a local directory first; the sanitized summary is
committed as `docs/test-evidence/s7-t7-device-validation.md` (with the raw set staying local
and being listed in the manifest from C5).

**Stop-and-report triggers:** DNS configuration changes outside the app's own files; the TV
loses LAN reachability; protection cannot be restored to ON; the read-back does not match the
staged set after two attempts; any HBC/LG preference would have to change to proceed.

## 6. Owner decisions this plan depends on or raises

1. **Documentation target (blocks D):** sanitized docs into the public app repo, or into a
   private repo with a pointer left in the public one? (default: sanitize into the app repo's
   `docs/`, because that is where the project's other plans already live).
2. **Existing exposure (not blocking, but worth a decision):** both repositories are public
   and the committed evidence already contains LAN addresses and Mac-mini paths. No history
   rewrite is proposed; the question is whether future evidence documents should be sanitized
   by default (default: yes).
3. **Carried from the previous close-out:** should the upstream list repo publish an
   app-native sixth format from CI, and how should the mode-B verification gap in the T9
   evidence be treated?

## 7. Definition of done for this plan

- A1-A8 recorded with PASS/FAIL/UNVERIFIED and a committed sanitized evidence doc.
- The shell suite is green on a clean checkout, with the three former failures classified.
- C1-C5 merged; no stale TV address remains in scripts or docs.
- The session map and runbook are under version control (or explicitly placed in a private
  repository with the decision recorded), and a secrets scan has been run over whatever was
  committed.
- The Mac mini holds no unique copy of any non-sensitive document.
- Feature work (E) starts only after that, each item with its own plan.

## 8. First task, ready to hand over

> Continue the LG TV Blocklist App project from the 2026-10-09 status handover.
>
> **Priority: complete outstanding T7 real-device validation.**
>
> 1. Inspect the current repository, session map and T9 runbook.
> 2. Confirm the TV is reachable at its current address; do not assume old addresses are valid.
> 3. Identify and safely clean up leftover test processes and temporary files.
> 4. Validate domain override Apply, exact read-back, SAFE zone-anchor behaviour and the four
>    outstanding TV webview navigation/visual checks.
> 5. Check HBC command transport under the real APP_DIR if practical.
> 6. Record commands, results and evidence. Clearly distinguish PASS, FAIL and UNVERIFIED.
>
> Do not implement new features or perform unrelated refactoring. Preserve existing TV
> settings. Stop and report if testing could disrupt the working DNS configuration.
>
> Finish with a concise summary of remaining blockers and the next recommended task.

Precondition added by this plan: if the TV is not on and reachable, the correct output of that
task is a short UNVERIFIED report - not a workaround.
