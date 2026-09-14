# S1 hardware test — G1 install / launch / hook / uninstall

> **Staged 2026-09-14 (pre-T5).** Only the "artifact under test" block below is recorded
> fact. The "Observed results" section is filled with actual captured outputs during the
> hardware window (plan Task 5, step 11) — nothing there is a hardware result yet.

## Artifact under test (staged 2026-09-14)

- CI run: `34843186641` — https://github.com/furkan-bayrak/lg-tv-blocklist-app/actions/runs/34843186641
  (success, 30 s; `webosbrew-ipk-verify` pass)
- Artifact: `ipk` = `io.github.furkanbayrak.lgtvblocklist_0.1.0_all.ipk` + `app.manifest.json`
- Local copy for T5: `dist-ci/` (gitignored) — refreshed from the run above
- sha256 (`dist-ci/io.github.furkanbayrak.lgtvblocklist_0.1.0_all.ipk`):
  `3d32927f230d88d3c25eeaeb010d87eea0238a06d1e6c873c74141538b037eb8`
  — matches the CI "Show artifact hash" log line and `app.manifest.json.ipkHash.sha256`.
  Install from `dist-ci/`; if CI re-runs later (e.g. a docs-only push), do not re-download —
  packaging embeds per-run timestamps, so a later artifact has a different sha256.
- Supersedes: `479bad8d…b2639` — the pre-review artifact, now stale. It could boot to a
  bare "Bridge unavailable" because `webOS.*` is not platform-injected and no webOSTV.js
  was bundled (S1 code review — the one High finding).
- Fix commit: `ed495ff` — vendors `app/vendor/webOSTV.js` (official LG webOSTVjs 1.2.13,
  Apache-2.0; version/license/sha256 pinned in `THIRD-PARTY-NOTICES.md`), loads it in
  `index.html` before `js/bridge.js`, and adds `LgBlocklistBridge.diagnose()` /
  `libVersion()` for honest missing/too-old failure states.

Canonical header (Task 5, step 11 — filled during the test):

- Date: `<test date>`
- Device: LG G1, model `<model>`, webOS release `<release from TV settings>`
- App: io.github.furkanbayrak.lgtvblocklist 0.1.0
- IPK: io.github.furkanbayrak.lgtvblocklist_0.1.0_all.ipk
- sha256: `3d32927f230d88d3c25eeaeb010d87eea0238a06d1e6c873c74141538b037eb8`
  (re-verify on the TV at step 2)
- Built by: GitHub Actions run 34843186641 (ubuntu-24.04; webosbrew-ipk-verify: pass)

## Observed results

_Not yet run — the hardware window is 2026-09-15. Fill with actual captured outputs per
plan Task 5 steps 1–11. First launch is expected to show "Not checked yet … webOSTV.js
1.2.13 loaded." — not "Bridge unavailable"._

## Disclosure

Development of this app is AI-assisted; builds are reproducible in CI and every hardware
result above was produced on a real TV by the repo owner.
