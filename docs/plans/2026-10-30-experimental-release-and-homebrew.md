# Experimental release and Homebrew Channel submission

This plan supersedes only the sequencing in the 2026-10-09 continuation plan, not product semantics or specification. Existing app behavior, including SAFE default and OFF baseline, remains authoritative.

## Plan A — bounded experimental release

1. Freeze scope to the existing standalone app, SAFE/STRICT modes and toggles. Do not add features, rewrite, or perform general cleanup. Resolve real required-suite failures; do not disable tests.
2. Obtain human safety review (separate from agent reviews) of root-command validation, firewall ownership/fail-open behavior, writes and uninstall. Preserve the observed OFF baseline; never enable protection as part of this work.
3. Build a candidate IPK from a recorded commit. Verify hash and notice/licence checks.
4. On an identified G1 device, test the actual candidate: install; allowed and blocked DNS; Apply sparse payload and exact read-back; SAFE apex materialization; remote navigation; disable restores prior routing; reboot/failure recovery; uninstall cleanup. Preserve and restore actual OFF baseline and existing settings. Use user-assisted panel evidence only where automation is unreliable; never report a simulated PASS as device evidence.
5. Confirm current device model/webOS version before claims. Historical evidence supports G1/webOS 6 only; make no broad compatibility claim. Document essential prerequisites, limitations, recovery and licence.
6. Owner approval is required before publication. Keep prior IPK and local app-state snapshot; test restoration to pre-window OFF. Do not change firmware/OTA, LG preferences, router or Mac services.

Defer automatic list updates, external-only mode, new onboarding/restore features, generic hardening and documentation migration unless a demonstrated release blocker requires a separate decision.

## Plan B — Homebrew Channel distribution

Source documents to recheck live before submission: `https://github.com/webosbrew/apps-repo/blob/main/README.md`, `.github/pull_request_template.md`, `content/pages/submit.md`, and `content/schemas/api/PackageManifest.json`. Upstream requirements may change.

- Reuse and audit existing CI, which already builds the IPK and generates/validates the manifest; do not duplicate that pipeline.
- Publish IPK, icon and manifest. Ensure schema-compatible numeric version, download URL, SHA256, `rootRequired`, and matching app identity/version. Verify anonymous download links and checksums. Prefer version-pinned experimental asset URLs to avoid latest/prerelease ambiguity.
- Prepare `packages/<id>.yml` catalog PR with title, iconUri, manifestUrl, category, pool and description. Include real-TV evidence, honest AI disclosure, and meaningful HUMAN development/testing/review; agents do not satisfy a human-review requirement. Acceptance and timing are not guaranteed.
- Owner approval is required before public release or PR. After acceptance, verify catalog installation and uninstall on a real device.

## Internal safety blocker milestone (2026-10-30)

Treat only the evidenced disable/recovery defects as release blockers; do not broaden into general hardening. Static control-flow review found (not device-reproduced): keeper recovery may resume after rollback turned intent OFF during the upstream wait, and unchecked owned-rule cleanup can kill the resolver/report OFF while an OUTPUT redirect remains. Details and source-contract are in `/home/macmini/.pi/orch/sessions/subagent-artifacts/outputs/a297285e-a643-49d8-a99a-004c68fde201/lg-disable-safety-contracts.md`.

Future fix scope: `app/scripts/common.sh`, `app/scripts/keeper.sh`, `app/scripts/rollback.sh`, `app/scripts/apply.sh`, `app/scripts/guard.sh`, and `tests/shell/run-tests.sh` only, subject to writer review. First add deterministic TDD regressions using local command stubs: rollback during upstream wait; injected owned-rule `-C`/`-D`/`-F` failures. No real firewall/network or long sleeps. Keep keeper upstream wait outside the shared lock; acquire before recovery mutation, re-read ON intent, abort if OFF/busy, serialize terminal fail-open and ensure lock release on termination/timeouts without nesting. Cleanup must retry boundedly and verify owned OUTPUT redirects absent before killing the serving resolver or claiming OFF; failures stay truthful and retain safe active service/retry/recovery. Never flush global/foreign rules or alter settings. Distinguish absent owned chain/rule from command/xtables errors.

Preserve existing strict `RESULT=/reason=` contract if possible; adding a failure reason requires checking `src/main.ts` and its tests. Do not widen UI scope without evidence. Run full required suites with command, exit status and `GATE-PASS` evidence, then obtain code-reviewer and the same security-auditor re-review before any candidate package. No device behavior is proven by this static audit. Later rollback requires separately authorized git revert and restoration of the pre-window OFF baseline if hardware is ever touched; none was touched in this phase.

## Shell diagnosis (2026-10-30)

The original checkout was copied to an isolated `/tmp` scratch tree without `.git` or credential-like files; no changes were copied back. Test output: `/tmp/lg-release-shell-tests-20261030.log`; scratch: `/tmp/lg-release-diag-a2677svk`. `sh tests/shell/run-tests.sh` reported 511 passed, 3 failed. The three failures are the S4 T4 `dnsq nc` REFUSED, empty and short-response cases (`tests/shell/run-tests.sh:1604-1615`): all returned `rcode=0 ancount=2 A=104.20.23.154` rather than the fixture-specific outcomes. NOERROR passed.

Initial hypothesis that the fixture path was not exported is contradicted by the test: `run_dnsq_nc` exports `NC_RESPONSE_FILE` and passes it via `env` (`tests/shell/run-tests.sh:1590-1595`). The same fixture reports output consistent with a real NOERROR lookup, so classify these cases as unresolved path/branch contamination, not a proven fixture defect or production parser defect. Likely next discriminator: trace `command -v node`, resolved `nc`, and PATH/stub selection at invocation in scratch, then ensure the canary deterministically selects the intended nc fallback before testing the three response classes. Do not weaken assertions. No application changes made.
