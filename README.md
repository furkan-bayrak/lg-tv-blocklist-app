# lg-tv-blocklist-app

Companion app to [furkan-bayrak/lg-tv-blocklist](https://github.com/furkan-bayrak/lg-tv-blocklist):
one switch to stop LG ads and telemetry on a rooted LG webOS TV, installed from
the Homebrew Channel. No server, no extra hardware, no router changes.

**Status: early development — Slice S1 (installable skeleton).** Blocking is not
implemented yet. This repo currently proves the whole delivery chain: the app
builds into an installable `.ipk`, installs, launches, registers/removes its
startup-hook symlink, and uninstalls cleanly on a real TV (LG G1, webOS 6 — see
`docs/test-evidence/`).

## What exists today

- `app/` — the packaged web app (plain HTML/CSS + TypeScript compiled to ES5)
- `src/` — TypeScript sources; pinned compiler, no framework, no runtime dependencies
- `app/scripts/boot.sh` — the startup-hook script the app symlinks into
  `/var/lib/webosbrew/init.d/` (never copied — webosbrew store rule)
- `tools/check-es5.mjs` — build check: the compiled bundle stays conservative ES5
- `.github/workflows/build.yml` — CI: build, package, Homebrew manifest
  (`rootRequired: true` in the manifest), `webosbrew-ipk-verify` compatibility report

## Build

Requires Node.js 20+ (22 recommended).

```sh
npm ci
npm run dist   # -> dist/io.github.furkanbayrak.lgtvblocklist_0.1.0_all.ipk
```

## Design

`docs/design.md` (approved design spec) and `docs/prd.md` (product requirements
summary). Mechanics live in the design spec.

## Limits (honest, day one)

- Requires root + the Homebrew Channel.
- Nothing in this skeleton blocks anything yet.
- Tested on a real TV: see `docs/test-evidence/`.

## License

MIT — see LICENSE.
