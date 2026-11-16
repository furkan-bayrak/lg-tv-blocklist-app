# Finish the app, then submit to Homebrew Channel

Date: 2026-11-11. Status: proposed execution plan; no device or publication authorization granted by creating it.

## Goal and scope

Finish a safe, usable experimental release of the existing standalone rooted-webOS app, prove it on a real TV, publish a reproducible release, then submit it to the central Homebrew Channel catalog.

Use the existing SAFE/STRICT profiles, domain overrides and bundled resolver. Do not restart development or add features merely to make the release feel complete. Automatic list updates, an in-app updater, a new restore wizard and a redesigned onboarding flow are deferred, not claimed complete. Essential usage/help, recovery instructions and honest limitations ARE release requirements. Homebrew Channel handles application updates; bundled-list freshness must be stated separately.

This plan replaces the release sequencing in the October 30 and November 2 plans, not the product specification. In particular, the October 9 instruction to finish with protection ON is superseded: restore the observed pre-window OFF baseline. Historical test results and approvals remain historical, not approval of a different package.

Immediate pre-trial implementation now follows [Usable app and controlled 24-hour LG trial](2026-11-11-usable-app-and-24h-lg-trial.md), approved in direction on 2026-11-11. Complete its bounded local usability/safety/package work, then an explicitly authorized LG smoke check and SAFE day trial before resuming publication/catalog work below. Preserve the uncommitted issue #1 documentation and issue #2 ESLint migration; the historical candidate is not a build of those changes.

Local implementation checkpoint: new experimental **0.4.3** work follows that plan,
with a distinct frozen source snapshot/IPK at
`lg-release-0.4.3-20261111-trial-r2`.
See [host evidence and LG runbook](../test-evidence/2026-11-11-0.4.3-host-and-lg-trial.md).
The starting-point bullets below describe the historical 0.4.2 candidate, not
the completed local usability changes. Human/device/publication gates remain open.

## Starting point: what exists versus what is accepted

- Historical code candidate was built from `05348772fb35c9a320455d2b029f3021c5647bc4`; subsequent app commit `9e66050` only adds the original release plan.
- Immutable historical candidate: `lg-release-0534877-candidate`.
- Its existing provenance records IPK SHA256 `8237cd01452547396a36213240dc04f1c5b4f37a420a7f613d0c767152cdef4e`, size 4,654,240 bytes; manifest SHA256 `5e3fab9b1ccb235aafeca5b47d656f44b02822adf3a2ef1fcffb90a012f24ef3`. These values were read, not independently rehashed for this planning task.
- Packaging normalization and truthful package description are implemented. Do not redo those changes. Existing candidate provenance explicitly leaves the official verifier to a parent gate; locate any later evidence before rerunning it.
- The old source/IPK reviews do not establish acceptance of this new candidate. Real-device acceptance of its exact bytes, human review, final public assets and catalog acceptance are not established here.
- README now describes experimental 0.4.3, implemented readiness/help/removal and pending device/publication acceptance. Automatic updates are not part of the trial scope.
- Existing `.github/workflows/build.yml` builds/tests/packages, generates a manifest, runs the verifier and uploads a CI artifact. It has no release-publication job; its icon points to mutable main. A CI artifact is not a durable anonymous download for the catalog.

## Stage A — finish and accept the app

### A1. Establish one accurate release checkpoint

Actions:
1. Collect source reviews, host test logs, candidate provenance and any later exact-artifact verifier/review reports. Map every verdict to source commit and IPK hash; mark missing evidence UNVERIFIED, not failed or passed by inference.
2. Reconcile the historical session map with this checkpoint. Preserve old evidence; distinguish old candidate `9b961cad...` from new candidate `8237cd01...`.
3. Inspect product requirements against implemented release behavior. List only demonstrated correctness, safety or essential usability gaps as blockers; keep optional features outside the release.
4. Record app ID, numeric package version, bundled-list revision/date and supported-device evidence. Do not assume the separate blocklist repository's newer fixes are in this snapshot. Review current known breakage reports against bundled data; if applicable, update through the existing generator/pin path and retest affected SAFE/STRICT behavior rather than manually editing generated output.
5. Check whether 0.4.2 has already been publicly distributed. Do not replace a published version with different bytes. If needed, use the next unused numeric version consistently in app/package metadata and CI assertions; communicate experimental status in release text, not an incompatible version suffix.

Deliverable: one release checklist with PASS / FAIL / UNVERIFIED, evidence pointers, exact candidate identity and a bounded blocker list. No blanket reimplementation or automatic full-suite reruns.

### A2. Close offline source and package gates

Actions:
1. Reuse valid evidence for unchanged source. If required evidence is absent, run the existing applicable checks once for the frozen source: `npm test` (build, ESLint ES5 syntax validation and behavior suites); existing POSIX ShellCheck; existing CI packaging/payload assertions. Record commands, exits and logs. ESLint replaces the old custom ES5/Node 8 syntax gates; static parsing still does not prove device compatibility. Do not introduce a second validation framework.
2. Verify the actual candidate's checksums, source provenance, pinned ARM runtime and included license/attribution files. Inspect MIT, Apache-2.0, ISC and CC BY 4.0 obligations; source-only top-level notices are not automatically sufficient for binary redistribution. The current candidate provenance says app-level LICENSE/THIRD-PARTY-NOTICES are excluded: resolve any actual distribution-notice gap before release.
3. Inspect normalized ownership/modes, byte identity, allowed paths and absence of unexpected links/hooks/private files in the IPK. Archive permissions alone do not prove installed full-path safety.
4. Locate the exact-candidate official verifier result; if absent, run the unmodified pinned verifier using the existing unprivileged, read-only, no-network sandbox and full pinned firmware dataset. Preserve the real exit/output; no filtered firmware run or patched verifier to obtain green.
5. Validate the final manifest against the current authoritative manifest schema and actual IPK identity/version/size/SHA256/rootRequired=true. Locate the schema through current upstream documentation/tooling; the old schema URLs returned 404 during planning. Do not label a handful of JSON assertions as schema validation.
6. Complete independent code/security review of changed source and the exact candidate. Resolve concrete findings, then re-review affected changes. Agents can assist but cannot satisfy the human gate below.

Change rule: fix only demonstrated blockers using existing conventions. A source, payload or package-version change produces a NEW staged candidate and new hashes; preserve old candidates. Re-run affected checks and reviews, not unrelated completed work. Freeze one accepted artifact for device testing.

Exit gate: source/package checks accepted with exact hashes, no unresolved safety blocker, licenses accounted for, static compatibility limitations accurately recorded. No claim of broad webOS support from verifier output.

### A3. Make the release usable and reviewable

Actions:
- Update README and create `docs/releases/<version>-experimental.md` with prerequisites (root, Homebrew root service, tested platform/runtime), SAFE default, STRICT breakage warnings, domain staging/Apply/reset semantics, list snapshot date, and explicit non-features.
- Explain initial OFF state, enabling/disabling, recognizable errors, recovery from failed Apply and the safe uninstall sequence using implemented interfaces. Do not invent backup/restore capabilities or copy unverified privileged commands.
- Explain that this is DNS-layer blocking, not a guarantee of removing every ad or blocking every telemetry path. Firmware/OTA settings remain outside the app's control.
- Ensure an ordinary tester can find essential usage and recovery help. Add only missing essential in-app guidance if evidence shows documentation alone is inadequate; no onboarding redesign.
- Have an experienced human developer meaningfully review the generated code and safety-critical flows: root-command validation, owned firewall rules, fail-open/disable races, persistent writes/startup and uninstall. Record reviewer, scope, findings and resolution truthfully. Obtain real human testing participation; agent approvals are not substitutes.

Exit gate: release documentation matches the frozen candidate; human review has no outstanding release blocker. Do not assert compliance with Homebrew's human-development/review policy based solely on an owner's unexamined approval.

### A4. Perform one controlled real-TV acceptance window

Preconditions: separately authorized device work; current address/model/webOS release/SoC confirmed; authenticated access and recovery route available; previous working IPK and app-state snapshot retained securely. One device writer; freeze scripts and candidate bytes for the window. Back up actual state before modification, not after failure.

Before enabling root-invoked code, inspect the actual installed full parent/application/helper/runtime/boot-hook paths: owners, modes, ACLs and replacement rights. No untrusted uid may replace code on a privileged execution path. Unsafe installation is a hard stop even when the IPK metadata is correct.

Record exact installed package/script/runtime hashes and observe:
1. Clean install/launch, permission/root-service failure behavior, and a fresh SAFE preset without silently enabling protection. Preserve the prior installation/state needed to return to baseline.
2. One authorized enable: ordinary allowed DNS works; representative blocked DNS is blocked; status matches actual rules/processes.
3. SAFE/STRICT switching and sparse domain changes: stage at least three changes including a removal, Apply once, exact effective read-back in metadata order and matching entry count. Reset returns the preset; discarded changes are not silently applied.
4. SAFE anchor affects the apex only; STRICT anchor blocks the subtree. Exercise Homebrew root-service transport through the real installed app path.
5. Real remote/UI operation: visible focus, scrolling, Enter/Back, Apply and Reset confirmation; hidden dialog controls stay out of focus order. Include readable errors and no-root guidance.
6. Disable restores the pre-enable DNS routing and removes owned redirects without killing a still-needed resolver. Validate permitted, bounded failure recovery; do not deliberately break firewall/LAN state merely to reproduce host-only fault injections.
7. Authorized reboot with the relevant app intent verifies startup/recovery. Record any unsafe-to-exercise failure case as UNVERIFIED, not a simulated device PASS.
8. Uninstall after safe disable removes owned startup hooks/processes/rules and leaves networking usable. Test direct Homebrew uninstall behavior too: upstream has no uninstall hook, so files/state outside the app container MUST be harmless after removal, even without a pre-disable step. Startup scripts must be symlinked, check target existence and stop when absent; no system-partition writes. Pre-disable instructions do not excuse unsafe direct removal. Verify this in source before attempting it on hardware; unresolved unsafe removal is a blocker.
9. If an older installed version exists, test upgrade and retained configuration, not just a clean installation. End with the actual pre-window OFF baseline restored and no unrelated TV preferences changed.

Record PASS / FAIL / UNVERIFIED per check, measured DNS interruption and sanitized screenshots/notes in `docs/test-evidence/`; sensitive raw logs remain private. Loss of reachability, unexplained DNS changes, unsafe ownership or inability to restore OFF stops the window and invokes the prepared recovery procedure.

Exit gate: all release-critical checks PASS on the exact candidate. Claim only the model/webOS actually tested; a G1/webOS 6 result does not establish support on newer or older TVs. Test the oldest platform claimed before expanding that claim.

### A5. Freeze release acceptance

Publishable evidence includes source commit, final package version/hash/size, runtime/list pins, checks/reviews, tested hardware/software, known limitations, notices and recovery instructions. Record owner approval for the experimental release after reviewing that evidence. Stage A is done only when the exact artifact is accepted, not merely when a package builds.

## Stage B — release hosting and Homebrew Channel listing

### B1. Prepare publication using the existing pipeline

- Extend/reuse the existing build workflow rather than creating a competing build path. Publication needs an explicit release/tag path with narrowly scoped write permission; retain read-only permissions for ordinary PR builds.
- Publish the accepted IPK, generated manifest, icon and checksums as durable HTTPS assets. Do not silently rebuild a different package during publication. If CI builds the release package, compare it byte-for-byte with the accepted candidate; a mismatch returns to artifact acceptance and affected device checks.
- Keep the normalizer BEFORE hashing/manifest generation/upload. Generate the publication manifest from the final IPK with its final URL, pinned icon URL and rootRequired=true. Public URL changes legitimately change the manifest hash, not the accepted IPK hash; validate and record the publication manifest separately.
- Keep IPK/icon URLs version-pinned. Use a maintained manifest URL for catalog updates. For an experimental prerelease, do not assume GitHub `releases/latest` resolves to it: initially use an explicit release URL and update the catalog pointer on later releases, or use an upstream-accepted maintained channel endpoint. Never point users at the old unpublished relative-basename draft.
- Use an unused numeric app version; a GitHub tag/release title may label it experimental. Preserve prior release bytes for rollback.

Exit gate: a reviewed publication change and local final assets are ready. Actual push/tag/release requires explicit owner authorization; planning is not that authorization.

### B2. Publish and prove anonymous availability

After authorization, push the required source/docs and publish the release assets. From an unauthenticated clean client, fetch manifest, icon and IPK, follow redirects, and verify HTTP success, JSON/schema, exact size and SHA256, matching ID/version, rootRequired and usable URLs. Ensure source/attribution links resolve. No expiring CI download URLs, authentication requirement or local paths.

Exercise installation from the hosted manifest/IPK on the authorized test TV through the supported Homebrew flow before claiming distribution works; use an upstream-supported custom repository only if necessary, not a newly built distribution system. Restore OFF afterward.

Exit gate: anonymously downloadable, exact tested IPK; final manifest and icon verified; hosted installation evidence recorded.

### B3. Submit to the central catalog

1. Recheck current `webosbrew/apps-repo` rules, schema, examples and PR template immediately before submission. The repository README/template explicitly require AI disclosure and meaningful human development/testing/review; the older rendered submission page omits that rule, so do not rely on its omission.
2. Fork apps-repo and add `packages/io.github.furkanbayrak.lgtvblocklist.yml`, subject to upstream naming conventions. Use title `LG TV Blocklist`, category `system`, pool `main`, public iconUri and manifestUrl, and a concise description of root requirement, experimental status, SAFE/STRICT risks and tested scope. Add real screenshots under fields accepted by the current catalog validator. Do not guess webOS/SoC requirements from static verifier labels.
3. Run the catalog repository's own validation/lint commands for the new entry. Follow actual schemas where prose examples disagree; no invented package fields. Link source, license, release notes and device evidence through accepted description/PR fields.
4. Prepare an honest PR: what the app does, exact tested TV/webOS and package hash, install/disable/reboot/uninstall evidence, human review/testing and AI-coding disclosure, safety limitations and recovery. Do not tick the human-review declaration without the corresponding work.
5. With separate owner approval, open the PR. Respond to maintainer findings with bounded fixes. New source/IPK bytes repeat affected acceptance gates; do not alter an already published release in place. Acceptance and timing are the maintainers' decision, not guaranteed.

Exit gate: catalog PR merged and the entry actually appears in Homebrew Channel. A PR submission alone is not catalog delivery.

### B4. Verify the actual catalog delivery and future updates

On an authorized supported TV, install via the merged central entry, launch and check displayed version/root behavior, enable/disable, then uninstall and verify cleanup. Restore OFF baseline. Confirm downloaded hashes match release evidence. If the entry is missing or installation fails, investigate the catalog/hosting issue rather than claiming completion.

Document the repeatable update path: fix/change, version bump, existing CI checks, accepted package, real-device checks appropriate to the change, new immutable assets and updated manifest pointer. A fixed initial manifest URL needs a catalog update; a maintained channel URL needs verification that users discover the new version. Retain prior release and recovery instructions. App updates and bundled-list updates are separate responsibilities.

## Completion criteria

- Existing feature scope works on the real supported TV; critical safety/recovery/uninstall checks pass; OFF baseline restored.
- Human safety/code review and real-TV testing are recorded honestly; unsupported compatibility is not advertised.
- Release docs, licenses, versioned IPK/icon, final manifest and checksums are publicly accessible and consistent.
- Homebrew rules/validation pass, PR is accepted, and real installation/uninstallation from the central catalog succeeds.
- Optional deferred features remain clearly documented as deferred, not silently represented as finished.

## Immediate next action

Resume the immediate pre-trial plan from the linked runbook's parking record. Local implementation and exact candidate installation/read-only LG UI checks are recorded; actual blocking, cleanup/startup changes, reboot/uninstall/recovery, human safety review and the SAFE day trial remain incomplete. Preserve historical candidates and existing evidence. Reconfirm the supervised TV window before mutations. Resume publication/catalog stages only after actual trial acceptance and owner approval.

## Sources checked for this plan

- [Current catalog rules and package example](https://github.com/webosbrew/apps-repo/blob/main/README.md)
- [Current submission checklist and AI declaration](https://github.com/webosbrew/apps-repo/blob/main/.github/pull_request_template.md)
- [Current publishing guide](https://www.webosbrew.org/develop/guides/publishing/how-to/)
- [Publishing rules: human review, uninstall safety and licensing](https://www.webosbrew.org/develop/guides/publishing/rules/) — no uninstall hook; external remnants must be harmless, startup scripts symlinked and missing-target-safe, and a main-pool manifest must expose a public sourceUrl.
- [Rendered catalog submission page](https://repo.webosbrew.org/submit) — less complete than the current repository rules.
- [Homebrew Channel interfaces and installation behavior](https://github.com/webosbrew/webos-homebrew-channel)

Local evidence read: existing October/November release plans, README, package.json, build workflow and candidate BUILD-SOURCE.json. No build, tests, verifier, TV operations or publication were performed to create this plan. Upstream schema location and final catalog validators must be resolved during execution; failed legacy URLs are not evidence that validation is unnecessary.
