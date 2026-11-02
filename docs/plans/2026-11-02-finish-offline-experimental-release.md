# Finish Offline Experimental Release Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Finish all offline work for an honest experimental Homebrew Channel candidate without changing blocking behavior or publishing.

**Architecture:** Keep app identity/version 0.4.2, reviewed runtime code and pinned ARM runtime unchanged. Normalize generated IPK archive metadata after ares-package using a small standard-library Python tool, then generate/verify the manifest against the exact final bytes. Keep real-TV acceptance separate from static/package checks.

**Tech Stack:** Existing TypeScript/shell app, installed @webos-tools/cli 3.2.6, Python 3 stdlib unittest/ar/tar/gzip, official extracted webosbrew toolbox and isolated firmware dataset.

## Context and boundaries
- Owner: finish the app; no more process questions for already-authorized local work. No TV probes/actions, host/service/config changes, dependency changes, public push/release/catalog submission, external-only redesign, broad hardening or browser work.
- Source baseline 5a5146e3f614044be7634b204b7c7e8a0c073a30 passed213 TS/638 shell tests, source reviews and immutable candidate inspection. Original IPK9b961cad1bd21ac8f55960559b601de31233fa9123c0fe9e24a8b10dd0ccceab staysunchanged.
- Concrete blockers: package dirs0777/owners1000 and control/packageinfo0666; false 'no blocking yet' description; contradictory provenance/static summaries. Actual installed ownership/ACL/full-path protection remains mandatory before privileged enable even after archive hardening.
- Installed packager has no mode/owner option and resets umask to zero. Source chmod alone does not solve metadata. Do not modify node_modules.
- Archive incident is independently repaired/verified before any further archive append. Global docs/state must not be touched by app implementers.

### Task 1: Test and implement metadata normalization
**Files:** Create tools/normalize-ipk.py and tests/packaging/test_normalize_ipk.py; modify package.json, .github/workflows/build.yml, app/appinfo.json; include this plan in the implementation commit. No app/scripts or src edits.
1. Write failing stdlib unittest fixtures first. Run python3 -m unittest discover -s tests/packaging -p 'test_*.py' to demonstrate RED for the missing normalizer/unsafe metadata.
2. Cover computed metadata and payload hashes, deterministic repeated output/idempotence, valid ar/tar/gzip structure, canonical duplicate paths, traversal/absolute paths, links/special files/set-id, malformed/unexpected archive members and unchanged input on rejection.
3. Implement CLI `python3 tools/normalize-ipk.py <generated.ipk>` with atomic generated-file replacement. Permit only the expected three Debian ar members, expected control contents, this app's payload/packageinfo paths and parent directories; bounded input/decompression. Never extract archive paths onto the host.
4. Set ar/tar uid/gid0, tar uname/gname root, dirs0755, control/packageinfo/assets0644, only this app's shell helpers and dnscrypt-proxy0755; clear special bits and normalize timestamps/compression metadata deterministically. Preserve every regular-file payload byte and valid IPK layout; do not execute ARM or package hooks.
5. Add npm run test:packaging and include it in npm test. Wire normalization into existing npm packaging/CI packaging flow BEFORE content assertions, hashing, manifest generation or artifact upload. Replace obsolete CI blanket0666 assertions with computed mode/owner/payload assertions.
6. Replace appinfo/package descriptive text with an accurate concise experimental DNS blocking/SAFE-STRICT/rooted-webOS/Homebrew description. Preserve id/version and runtime behavior. Generated manifest must inherit truthful text.
7. Focused tests must pass before a conventional implementation commit. Confirm diff limited to owned paths and original untracked plan untouched. Parent runs canonical npm test once for the resulting source; do not gratuitously repeat already completed baseline runtime suites locally. No commit with failing focused tests.

### Task 2: Independent source review
Code reviewer and security auditor review normalizer/parser, tests, CI and privilege claims independently. Any REQUEST CHANGES returns to implementation and re-review. Do not count an APPROVE with explicit failure/blocked evidence as accepted.

### Task 3: Build a new exact candidate after approved source
1. Fresh staging from the final committed source, not a mutated old candidate. Preserve original checkout/dependency target and old IPK. Use staging-only node_modules link, exact pinned runtime archive/binary/licences and existing trusted extracted tools; no network/install/config changes or ARM execution.
2. Build, package, normalize, generate official local draft manifest(rootRequired strictly true and relative IPK basename), then verify hash/size/id/version/description/URL draft status. Inline Python integrity checks are not official manifest-schema validation.
3. Use the existing unprivileged bwrap helper with full readonly host mount, isolated network/tmp, and unchanged fw-data mounted at official hardcoded /usr/share/webosbrew/compat-checker/data. Run unmodified official verifier with full defaults; no --fw-releases filtering/path override or verifier patches.
4. Record one reconciled current provenance verdict plus clearly historical earlier failures, actual final hashes, source/runtime/tool/dataset pins, transforms and actual verifier log labels. Do not claim continuous firmware support; static native/polyfill labels are not real-device proof.
5. Inspect exact normalized IPK: no unsafe paths/hooks/private payload, trusted archive ownership/modes, byte-identical payload, pinned runtime/licences, correct manifest. Review actual candidate/security independently without another full runtime-suite rerun. Keep artifact immutable after final hashes.

### Task 4: Finish release documentation and submission draft
**Files:** Update README.md; create docs/releases/0.4.2-experimental.md and docs/releases/homebrew-submission-draft.yml after checking official catalog fields. Use existing docs tree, no parallel documentation hierarchy.
- Explain actual app behavior, root/Homebrew dependency, AI assistance and pending owner human review; experimental/compatibility limits in plain language.
- Recovery/Disable/uninstall checklist must follow existing implemented interfaces; no invented or falsely TV-tested commands, no automatic backup claims or secrets. Installed complete-path ownership/mode/ACL/replacement protection is a hard pre-enable TV check.
- Record exact candidate source/hash evidence and local commands actually run. Keep real model/webOS/CPU, exact-hash install/Apply/SAFE-STRICT/readback/HBC/reboot/Disable/failure/uninstall and recovery evidence explicitly pending while TV is off.
- Submission YAML/PR text and public asset/icon URLs are DRAFT/not live-tested. Owner approval and device checks precede any push/release/catalog submission.
- Commit logical release docs with a conventional message after doc checks/review, preserve foreign files/index. Docs-only commits may refer explicitly to the earlier code commit used to build the candidate; no circular source-hash claim.

## Verification and completion
Require actual parent gates and code/security verdicts for source and exact artifact. Do not rerun completed stages because orchestration failed. Finish with app/source commits, immutable candidate path/hash, concise pass/fail evidence and only unavoidable TV/owner/publication gates remaining. Update one existing global archive entry and session map safely only after recovery is verified; exact byte backup before append and host prefix-fidelity guard are mandatory. State.md changes only if a current operational fact changed (none expected).

## Rollback
No deployment occurs. Keep original source5a5146e and IPK9b961cad immutable. Revert only the new implementation/docs commits if requested; never reset/clean foreign work or delete candidates. Reject normalization without changing its input if validation fails. Archive recovery must preserve full verified original plus existing findings, not HEAD alone.
