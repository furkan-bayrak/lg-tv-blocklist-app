# lg-tv-blocklist-app

Companion app to [furkan-bayrak/lg-tv-blocklist](https://github.com/furkan-bayrak/lg-tv-blocklist):
one switch to stop LG ads and telemetry on a rooted LG webOS TV, installed from
the Homebrew Channel. No server, no extra hardware, no router changes.

**Status: experimental — v0.4.3, local trial candidate.** Plain first-launch
prerequisite checks, SAFE/STRICT profiles, domain overrides, verified cleanup
and a startup setting are implemented. Fresh installs remain SAFE and OFF.
Earlier versions have LG G1/webOS 6 evidence in `docs/test-evidence/`; that does
not establish acceptance of these new bytes. Human safety review and a supervised
LG smoke check gate the 24-hour SAFE trial. No automatic updater or store listing.

Local candidate instructions and safety/device gates:
[0.4.3 host evidence and supervised LG trial](docs/test-evidence/2026-11-11-0.4.3-host-and-lg-trial.md).

## What exists today

- `app/` — the packaged web app (plain HTML/CSS + TypeScript compiled to ES5)
- `app/vendor/webOSTV.js` — vendored LG webOSTVjs 1.2.13 (Apache-2.0); the platform does
  not inject `webOS.*`, so the app bundles it — provenance + hashes in `THIRD-PARTY-NOTICES.md`
- `src/` — TypeScript sources; pinned compiler, no framework, no runtime dependencies
- `app/scripts/boot.sh` — the startup-hook script the app symlinks into
  `/var/lib/webosbrew/init.d/` (never copied — webosbrew store rule)
- `app/scripts/` blocking layer — `apply.sh`/`rollback.sh` (apply + rollback),
  `keeper.sh` + `guard.sh` (supervisor pair), plus the bundled filtering engine
- `app/scripts/guard.sh` — runtime fail-open watchdog, not a syntax checker or
  linter. It supervises protection on the TV alongside `keeper.sh`; development
  checks do not replace it.
- `eslint.config.mjs` — development syntax check via `npm run lint`: ESLint
  parses all shipped JavaScript (`app/**/*.js`, including generated `app/js`,
  TV-side helpers and vendored scripts) as ES5 scripts. The webview bundle also
  rejects CommonJS globals: it is loaded by plain `<script>` tags, not a module
  loader. TypeScript's `module: "none"` keeps sources as plain scripts.
  This replaces the custom pattern scanner and Node 8 download/parse gate:
  ES5 parsing already rejects the newer syntax Node 8 cannot parse.
  Syntax checks do not prove runtime API support or replace testing on a TV.
- `.github/workflows/build.yml` — CI: build, ESLint, tests, package, Homebrew
  manifest (`rootRequired: true`), `webosbrew-ipk-verify` compatibility report

## Build

Requires Node.js 20.19+ (20.x), 22.13+ (22.x), or 24+; Node 22 is recommended.

```sh
npm ci
npm run dist   # -> dist/io.github.furkanbayrak.lgtvblocklist_0.4.3_all.ipk
```

For development, `npm run build && npm run lint` checks the emitted JavaScript
and TV-side helpers without packaging. ESLint does not use `.gitignore`, so the
ignored `app/js/` build output is checked. Required globs for `app/js` and
`app/scripts` make missing or empty trees an error; build before linting.
`npm test` includes this check, then runs the application and packaging tests.

Packaging preserves a valid deterministic tar date: `SOURCE_DATE_EPOCH` if set
(positive 32-bit seconds), otherwise the source `app/appinfo.json` mtime.
Preserve that mtime when reproducing a frozen source snapshot. Epoch-zero file
dates are rejected by webOS installation; gzip/ar headers can still be zeroed.

## Design

`docs/design.md` (approved design spec) and `docs/prd.md` (product requirements
summary). Mechanics live in the design spec.

## Tiers and the domain list

- **SAFE (default) vs STRICT.** A fresh install selects SAFE, with protection OFF.
  The app displays bundled-list revision/date and the active preset’s entry count.
  STRICT adds aggressive domains and whole-zone rules. STRICT may degrade the LG store, break LG account login, and
  stop ThinQ, LG Channels and firmware updates from working - that is the tier's
  purpose, not a bug. STRICT is selectable at any time; switching re-applies the
  filter and can briefly interrupt DNS.
- **Zone anchors.** Zone rows can be switched on or off in either tier, but
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

### Reported firmware-update domains

[Issue #1](https://github.com/furkan-bayrak/lg-tv-blocklist-app/issues/1) reports
that blocking `su-dev.lge.com` and `nsu.lge.com` stopped updates on webOS 25
(10.3.2-33). The bundled STRICT preset already covers both: it has an exact
`=su-dev.lge.com` rule and a whole-zone `lge.com` rule covering `nsu.lge.com`.
`nsu.lge.com` is distinct from the separately listed `snu.lge.com`; neither name
should be silently substituted for the other.

SAFE intentionally blocks neither of these update hosts. If the STRICT
`lge.com` zone is disabled, `su-dev.lge.com` still has its own exact rule unless
that row is also disabled, but `nsu.lge.com` has no separate exact rule or row.
Do not enable the broad STRICT tier just to control updates: use LG/Homebrew
update settings. This is snapshot coverage, not a new device test or a guarantee
that DNS blocking prevents every firmware-update path.

## Limits (honest, day one)

- Requires root + the Homebrew Channel.
- Launch automatically checks Homebrew root access and required package components;
  mutations stay unavailable when readiness cannot be confirmed. Connection failure
  is not reported as proof that root is missing.
- **Start protection after reboot** controls only this app’s startup link. It
  resumes the saved ON/OFF intent; changing it does not enable protection now.
- **Disable and remove startup** asks for confirmation, verifies protection OFF
  before removing the owned startup link, and retains domain preferences. Keep the
  app installed if cleanup cannot be confirmed. Foreign startup files are not changed.
- Raw bridge/status diagnostics are under **Advanced**.
- Automatic updates and Homebrew publication are out of scope for this trial.
- Earlier real-TV evidence is not a pass for the current candidate.

## License

MIT - see LICENSE. The bundled domain-list data is derived from
[furkan-bayrak/lg-tv-blocklist](https://github.com/furkan-bayrak/lg-tv-blocklist)
and is licensed **CC BY 4.0**. Bundled third-party components are listed in
`THIRD-PARTY-NOTICES.md`.
