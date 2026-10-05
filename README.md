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
- `tools/check-es5.mjs` — build check: the compiled bundle stays conservative ES5.
  A heuristic pattern scan over a masked copy of `app/js`, `app/scripts` (both
  walked recursively) plus the `src/` plain-script guard — not an ES5 parser: it
  fails closed on input it cannot read and refuses a control keyword used as a
  property name, but an OK line means "nothing on the pattern list matched",
  never "this file is ES5", and the header names the misses measured so far
- `tools/check-node8.mjs` — `npm run check:node8`: runs the real node v8.17.0 parser
  (`--check`) over every shipped `.js` file, the closest proxy for the TV's node
  v8.12.0. Ground truth for the syntax node 8 refuses, and only that: node 8 also
  parses ES6, so measured `var f = () => 1;` is `--check` rc 0, and a named
  capture group passes `--check` too and throws only when the literal is
  compiled. The two gates cover different classes, so CI runs both and neither
  makes the other redundant.
  It fetches node@8.17.0 from the registry, so it is a CI step rather than part of
  `npm test`; offline, `CHECK_NODE8_ALLOW_SKIP=1` reports UNVERIFIED instead of
  failing (the default is to fail, never to pass silently)
- `.github/workflows/build.yml` — CI: build, package, Homebrew manifest
  (`rootRequired: true` in the manifest), ES5 pattern guard + node 8 parse gate,
  `webosbrew-ipk-verify` compatibility report

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
