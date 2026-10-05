# lg-tv-blocklist-app

Companion app to [furkan-bayrak/lg-tv-blocklist](https://github.com/furkan-bayrak/lg-tv-blocklist):
one switch to stop LG ads and telemetry on a rooted LG webOS TV, installed from
the Homebrew Channel. No server, no extra hardware, no router changes.

**Status: beta — v0.4.2.** DNS-layer blocking is implemented and working on a
rooted LG G1 (webOS 6.x): bundled filtering engine, apply/rollback, keeper + guard
supervision, boot auto-start, and fail-open behavior. Safe/Strict list modes,
self-update, first-run/help UX, and a store listing are not built yet. Evidence on
a real TV (LG G1, webOS 6 — see `docs/test-evidence/`).

## What exists today

- `app/` — the packaged web app (plain HTML/CSS + TypeScript compiled to ES5)
- `app/vendor/webOSTV.js` — vendored LG webOSTVjs 1.2.13 (Apache-2.0); the platform does
  not inject `webOS.*`, so the app bundles it — provenance + hashes in `THIRD-PARTY-NOTICES.md`
- `src/` — TypeScript sources; pinned compiler, no framework, no runtime dependencies
- `app/scripts/boot.sh` — the startup-hook script the app symlinks into
  `/var/lib/webosbrew/init.d/` (never copied — webosbrew store rule)
- `app/scripts/` blocking layer — `apply.sh`/`rollback.sh` (apply + rollback),
  `keeper.sh` + `guard.sh` (supervisor pair), plus the bundled filtering engine
- `tools/check-es5.mjs` — build check: the compiled bundle stays conservative ES5
- `.github/workflows/build.yml` — CI: build, package, Homebrew manifest
  (`rootRequired: true` in the manifest), `webosbrew-ipk-verify` compatibility report

## Build

Requires Node.js 20+ (22 recommended).

```sh
npm ci
npm run dist   # -> dist/io.github.furkanbayrak.lgtvblocklist_0.4.2_all.ipk
```

## Design

`docs/design.md` (approved design spec) and `docs/prd.md` (product requirements
summary). Mechanics live in the design spec.

## Limits (honest, day one)

- Requires root + the Homebrew Channel.
- Blocking is implemented (DNS filter + supervision), but Safe/Strict list modes,
  self-update, and the restore/first-run UX are still to come.
- Tested on a real TV: see `docs/test-evidence/`.

## License

MIT — see LICENSE. Bundled third-party components are listed in `THIRD-PARTY-NOTICES.md`.
