# Usable app and controlled 24-hour LG trial

Date: 2026-11-11. Status: bounded local implementation completed; exact 0.4.3 installation and read-only LG UI checks are recorded in the linked runbook. Protection tests, human safety review, the 24-hour trial and publication remain incomplete. Resume from the runbook's parking record, not the historical starting point below.

## Goal and release boundary

Finish as much as possible locally so the owner receives one usable experimental IPK, simple instructions and a recovery route, then performs a supervised smoke check followed by a 24-hour trial on their LG.

This is the immediate implementation plan. It takes precedence over the broader `2026-11-11-finish-app-and-homebrew-channel.md` for pre-trial work. Homebrew publication/submission remains later. Preserve existing SAFE/STRICT behavior, domain overrides, resolver, keeper/guard and fail-open architecture; change safety behavior only for an evidenced defect necessary for the agreed recovery/removal requirements.

No framework, new blocking modes, automatic list updates, in-app app updater, background telemetry, generic hardening project, configurable DNS system or redesigned onboarding wizard. Simple prerequisite feedback and existing-workflow controls are enough. Essential usability/recovery must be complete, not placeholders. No claim that the entire historical product backlog is implemented.

## Historical starting checkpoint: preserve and build on this

Repository: `furkan-bayrak/lg-tv-blocklist-app`.

- Last observed app commit: `9e66050`, a documentation-only commit after code `05348772fb35c9a320455d2b029f3021c5647bc4`. Inspect current state on resumption; do not reset unexpected changes.
- Issue #1 was investigated: STRICT already has `=su-dev.lge.com` and bare `lge.com`, which covers `nsu.lge.com`. SAFE covers neither. `nsu` is not the separately listed `snu`. README now explains this, the override caveat and lack of a firmware-update guarantee. Do not add redundant rules or expand SAFE to block OTA endpoints.
- Issue #2 local changes are implemented, verified and UNCOMMITTED: ESLint 10.14.0 replaces custom ES5/Node8 checkers; obsolete checker implementations/tests removed; package/lockfile, CI, README, TypeScript module:none and relevant generated/source comments updated. Runtime guard.sh remains a safety watchdog, not a linter. Preserve all this work. Development Node requirement now matches ESLint: ^20.19.0 || ^22.13.0 || >=24.
- Existing full `npm test` after those changes passed: build + ESLint, JavaScript 135 pass / 0 fail / 1 skip, shell 638 pass / 0 fail, packaging 13 pass. Skip: sibling blocklist HEAD differs from pinned snapshot. Shell emitted one temporary-directory removal warning; final cleanup reported 9 reaped and 0 survivors. Do not rerun unchanged checks just to confirm this observation.
- Throwaway probes accepted legal ES5 and helper CommonJS, rejected newer syntax/regex and webview CommonJS; TypeScript accepted plain script and rejected module source. No new permanent wiring tests were added.
- No changes pushed, issue comments posted or issues closed. Draft replies exist only in prior chat; public activity still needs owner approval.
- Existing historical candidate `lg-release-0534877-candidate` is immutable and predates these/new usability changes. Its recorded IPK SHA256 is `8237cd01452547396a36213240dc04f1c5b4f37a420a7f613d0c767152cdef4e`. Preserve it; do not distribute it as the new completed build. The older `5a5146e` candidate is historical too.

### Local execution record

Implemented 0.4.3 readiness/startup/confirmed removal, direct-uninstall supervisor
cleanup, bundled identity and list refresh. Existing issue fixes were preserved.
The new candidate directory is `lg-release-0.4.3-20261111-trial-r2`;
its source snapshot manifest, rather than the unchanged Git base alone, identifies
the uncommitted build. Historical candidates are untouched.

See [host evidence and supervised runbook](../test-evidence/2026-11-11-0.4.3-host-and-lg-trial.md)
and the candidate's `BUILD-SOURCE.json` / `evidence/` for exact outcomes.
Automated review corrected verified removal on non-DNAT TVs; it is not human approval.
LG smoke/day trial and public Homebrew acceptance remain UNVERIFIED.

Coherent refresh from the app root (disposable checkout, no sibling edits):

```sh
snapshot=$(mktemp -d)
git clone --quiet --no-hardlinks ../lg-tv-blocklist "$snapshot/source"
git -C "$snapshot/source" checkout --quiet --detach f5c0032198ee2034cbc778f720908117a4590f97
python3 -B "$snapshot/source/scripts/build.py" build
node tools/build-filter-input.mjs "$snapshot/source"
node tools/gen-domains.mjs "$snapshot/source"
node tools/gen-bundle-info.mjs
rm -rf "$snapshot"
```


## 1. Minimal first-launch readiness

Inspect existing bridge diagnostics, status probing and action gating first. Reuse them; do not build a parallel setup subsystem.

Deliver:
- On launch, automatically determine whether the packaged bridge/root service and required app components are usable, without enabling protection or registering startup as a hidden side effect.
- Explain missing root, missing/unusable Homebrew service or damaged package in plain language with an actionable next step. Never claim root solely because an API exists; distinguish connection failure from a confirmed missing prerequisite.
- Fresh install: selected preset SAFE, protection OFF. Existing install: preserve actual intent, tier and overrides; never reset a working installation on launch.
- Safe default focus and understandable loading/error states, with no indefinite actionable-looking buttons while status is unknown.

Acceptance: observe normal/no-root/service-failure/unknown-status cases on the actual rendered UI with controlled bridge fixtures. Mutations stay disabled when prerequisites cannot be established. Host simulations are not TV/root evidence.

## 2. One understandable startup setting

Replace the normal-user register/show/remove boot-hook controls with a clearly named `Start protection after reboot` setting. Diagnostics can remain available under a small Advanced disclosure, not a new settings framework.

Deliver:
- Read actual hook state; represent absent, ours, foreign/conflicting and unknown accurately.
- Reuse the existing fixed-command bridge and symlink hook mechanism. Never overwrite/delete a foreign hook.
- Clarify that startup preference and current ON/OFF state are different. Enabling startup does not silently enable protection now; disabling startup does not falsely claim current protection is OFF. Reboot behavior respects saved protection intent.
- Refresh and verify setting changes through actual state; retain single-flight command behavior and accessible remote focus.

Acceptance: correct state/read-back, conflict refusal, failure feedback, no accidental enablement, and no unrelated hook writes. Add regression tests only for plausible behavioral transitions not already covered.

## 3. Safe disable, startup removal and uninstall

Provide one confirmed `Disable and remove startup` action, not a new general restore wizard.

Deliver:
- Explain what will be stopped/removed and whether domain preferences remain; cancellation changes nothing.
- Complete verified disable first using existing cleanup ordering. Remove only our startup symlink after successful disable. If cleanup fails, show truthful failure and do not present the app as safely removed or destroy code still needed for DNS.
- Verify and report actual OFF/no-owned-startup state. Preserve user preferences unless the interface explicitly says otherwise; do not add hidden destructive reset behavior.
- Audit direct Homebrew uninstall as a separate safety path. Upstream has no uninstall hook: residual external state must be harmless when the app container disappears. A pre-disable instruction is helpful but not an excuse for unsafe direct removal. Check supervisor/process behavior and dangling startup targets; fix evidenced defects with the smallest compatible approach. Do not assume an uninstall callback exists or invent one.
- No system-partition writes. Preserve foreign firewall rules/hooks and existing resolver/network settings. Document any unavoidable limitation honestly; an unsafe direct-uninstall path blocks trial readiness rather than being disguised as done.

Acceptance: deterministic host scenarios for successful cleanup, cleanup failure, repeated invocation, foreign hook and application-directory disappearance. Use stubs/sandboxes, never the real firewall or TV. Human review of new privileged/safety changes is required before distribution; automated review is assistance, not human approval.

## 4. Useful status and current bundled data

Deliver:
- Display app version and bundled-list source revision/date derived at build time from real metadata/pin, not manually duplicated labels or wall-clock 'freshness'. Label bundled data honestly; no live-update claim.
- Keep actual protection/tier/domain count and readable errors; put raw diagnostics behind Advanced. Basic help already exists in index.html: refine it instead of rebuilding it. Fix stale README claims about missing help to match actual implemented scope.
- Refresh the bundled lists through existing generators and provenance conventions. Inspect the sibling `../lg-tv-blocklist` state and established generation workflow before writing. Use a coherent known committed source revision and matching generated outputs; never label dirty data with an unrelated HEAD pin.
- Include applicable current breakage corrections, particularly issue #25 in the separate list repository: eic.tv.wiselg.com was moved SAFE to STRICT in source commit f5c0032. Check current source/output first; do not reimplement that fix or assume the app already contains it.
- Keep the existing region policy and tier/anchor semantics. Regenerate all dependent lists/domain metadata/counts together; remove stale hardcoded counts where they would become incorrect using existing metadata. No app-local ad hoc domain-addition convention.

Acceptance: deterministic snapshot regeneration, coherent pin/data/UI counts, known breakage correction reflected, SAFE still default, and explicit bundled-list date visible. Check the actual UI at TV-like dimensions and keyboard/remote-style navigation. Browser proof does not establish real LG rendering.

## 5. Verified, frozen trial package

Use the existing build/package/normalization pipeline; do not create another build system.

Deliver:
1. Implement in logical bounded changes, keeping existing local issue fixes and unrelated files intact. No automatic commits/pushes unless authorized. Before a new candidate, freeze and record an exact source revision; if committing is not authorized, record an exact source snapshot manifest instead of falsely claiming a clean committed build.
2. Run the narrow checks for each changed behavior; after integration run the applicable canonical build/lint/application/packaging checks once. Reuse valid unchanged historical evidence rather than rerunning because a session ended. New tests cover behavior/failures, not wording, DOM source copies or mock echoes.
3. Exercise the actual UI, including prerequisite failures, startup setting, removal confirmation, Advanced disclosure, domain controls and remote-style focus. Use no real privileged device actions.
4. Review changed code/security boundaries; meaningful human safety review remains a prerequisite before enabling a new privileged implementation on the TV. If no such review is available, finish reachable implementation/evidence but report trial enablement as gated.
5. Build a NEW staged IPK without mutating historical candidates, verify normalized metadata, payload identity, pinned runtime and required licenses/attribution. Keep final package immutable once hashed.
6. Validate the actual IPK with the existing pinned official verifier and isolated read-only/no-network dataset arrangement where available. Do not patch/filter a verifier to obtain green or silently change host services/dependencies. Record missing external tools/data as exact prerequisites, not simulated acceptance.
7. Supply final source identity, package version, IPK path/size/SHA256, dependency/runtime/list pins, check results, known limitations and concise install/disable/recovery instructions. Do not replace publicly distributed bytes under an existing version; check version history before choosing the trial version. A local manifest remains a local draft, not proof of public Homebrew distribution.

Exit: no unfinished usability controls, no known safety blocker concealed, one frozen candidate ready for the separately authorized smoke window. Host completion is not device acceptance. No new feature work during the subsequent trial; a critical fix ends that candidate's trial and requires new acceptance evidence.

## 6. Owner-assisted LG smoke check and 24-hour trial

Device actions require a separate explicit window; do not probe the TV just to start implementation. Confirm current address, model, webOS release/SoC, Homebrew/root state, recovery access and actual installed state then. Historical baseline was OFF, not a live observation.

Before mutation: preserve current package/settings and networking baseline securely; verify installed parent/app/helper/runtime/hook ownership/modes/ACLs and untrusted replacement rights before enabling root-invoked code. Freeze scripts; one device writer.

### Supervised smoke check before leaving it running

1. Install the exact trial IPK and verify identity/hash. Launch, read prerequisites, select SAFE, and confirm protection remains OFF initially on a fresh installation.
2. Authorize enable, then verify allowed and representative blocked DNS plus truthful status. Try normal streaming, Content Store and login without purchasing or starting firmware updates.
3. Disable and prove original networking returns. Exercise safe startup removal and its reported state; do not lose the prepared recovery route.
4. Enable SAFE again with the owner-chosen startup preference. Test standby/wake and one authorized reboot; verify actual protection intent and DNS behavior afterward.
5. Verify domain Apply/read-back and representative remote navigation if not already accepted for these exact bytes. Test uninstall/recovery safety under controlled conditions, reinstalling the same package if needed for the trial.
6. Proceed to an all-day ON trial only after smoke/recovery checks pass and the owner explicitly agrees to that temporary baseline exception. Otherwise end OFF. Record FAIL/UNVERIFIED rather than pressing ahead through a safety failure.

### 24-hour SAFE trial

- Owner uses the TV normally: streaming, app launch, store/login, standby/wake and ordinary network use. No intrusive repeated probes, automatic network manipulation, paid actions or firmware-update attempts.
- Note time, app/action and symptom for any problem. If safe, compare with protection OFF to distinguish blocking from unrelated service failure. Preserve logs without secrets; do not collect browsing/DNS histories unnecessarily or upload automatically.
- Record actual protection state after standby/reboot and any unexpected outage/recovery. A full 24-hour pass means actual observed use, not a host simulator or an unattended timer claiming functionality.
- Stop for loss of DNS/reachability, repeated crashes, misleading ON/OFF state or inability to recover. Disable/restore via the prepared route; do not keep testing a broken candidate.
- At the end, record results and restore the pre-window OFF baseline unless the owner explicitly chooses to keep protection enabled.

STRICT is a later, separate controlled test because it deliberately risks service breakage. Do not mix it into the SAFE day and lose attribution. Real catalog publication/installation/update acceptance remains covered by the broader Homebrew plan after the trial and human approval.

## Done means

- First launch, startup setting, safe removal, status/list identity and current bundled data work end to end on the host surface, with focused behavioral evidence and no fake readiness claims.
- One exact new IPK plus readable installation/recovery/trial instructions is delivered; historical packages/work are preserved.
- Device/human prerequisites and any remaining unverifiable conditions are explicit. No claim that host completion proves LG usability, 24-hour reliability, broad compatibility or Homebrew acceptance.
- Following the authorized window, real smoke/trial observations are recorded separately from automated evidence.

## Continuation entrypoint

Local implementation is complete. Resume from the linked runbook's parking record and the frozen candidate's `BUILD-SOURCE.json`, `SOURCE-SNAPSHOT.json` and evidence; do not repeat implemented work or silently reuse a historical package. Exact candidate installation/read-only UI checks have device evidence; protection, cleanup/startup changes, reboot/uninstall/recovery and the day trial remain incomplete. Human review remains pending for final acceptance. Before any new local fix, inspect current changes, give changed bytes a new candidate identity and reverify affected behavior. Reconfirm the supervised device window before mutations; publication requires separate authorization.
