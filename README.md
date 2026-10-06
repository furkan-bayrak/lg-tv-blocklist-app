# lg-tv-blocklist-app

Companion app to [furkan-bayrak/lg-tv-blocklist](https://github.com/furkan-bayrak/lg-tv-blocklist):
one switch to stop LG ads and telemetry on a rooted LG webOS TV, installed from
the Homebrew Channel. No server, no extra hardware, no router changes.

**Status: beta — v0.4.2.** DNS-layer blocking is implemented and working on a
rooted LG G1 (webOS 6.x): bundled filtering engine, apply/rollback, keeper + guard
supervision, boot auto-start, and fail-open behavior. The Safe/Strict tiers (a
fresh install defaults to SAFE) and the per-domain list are implemented;
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

## Tiers and the domain list

- **SAFE (default) vs STRICT.** A fresh install runs SAFE: 20 high-confidence
  entries. STRICT is the aggressive tier on top of it: 115 distinct domains,
  materialised as 123 entries once its 8 zone anchors are repeated as bare
  whole-zone rules. STRICT may degrade the LG store, break LG account login, and
  stop ThinQ, LG Channels and firmware updates from working - that is the tier's
  purpose, not a bug. STRICT is selectable at any time; switching re-applies the
  filter and can briefly interrupt DNS.
- **Zone anchors.** The 8 zone rows can be switched on or off in either tier, but
  they mean different things. Under STRICT a zone anchor blocks the whole zone;
  under SAFE the same row blocks only its own name. The panel's per-row note
  states this for the active tier.
- **The domain list.** Open the Domains panel and toggle individual rows. The mode
  exists to self-debug STRICT: it makes every shipped domain visible so you can
  turn single ones off and find which one breaks a feature. Changes are staged
  until you press **Apply changes**. Apply rewrites the filter input and briefly
  restarts the filter, so DNS stops for a couple of seconds - it never happens per
  toggle. **Reset to preset** discards the staged changes and restores the active
  tier's preset exactly as it ships.
- **A save can be refused.** If the staged changes would leave a shipped preset
  with no entries, the TV refuses the save and the panel names the preset that
  would be emptied; nothing is written.
- **Firmware updates are not the app's job.** The app only informs you. To block or
  allow firmware/OTA updates, use the LG TV settings or the Homebrew Channel's
  update switch.
- **Attribution.** The domain lists and the generated metadata are derived from
  [furkan-bayrak/lg-tv-blocklist](https://github.com/furkan-bayrak/lg-tv-blocklist),
  licensed **CC BY 4.0**; they ship with this app under that attribution.

## Limits (honest, day one)

- Requires root + the Homebrew Channel.
- Blocking and the Safe/Strict tiers plus the domain list are implemented;
  self-update and the restore/first-run UX are still to come.
- Tested on a real TV: see `docs/test-evidence/`.

## License

MIT - see LICENSE. The bundled domain-list data is derived from
[furkan-bayrak/lg-tv-blocklist](https://github.com/furkan-bayrak/lg-tv-blocklist)
and is licensed **CC BY 4.0**. Bundled third-party components are listed in
`THIRD-PARTY-NOTICES.md`.
