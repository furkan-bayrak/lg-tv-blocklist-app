# Third-party notices

The packaged app bundles the components below. Everything else in this repository is
first-party (MIT - see `LICENSE`).

## webOSTV.js (webOSTVjs) 1.2.13 — LG Electronics

- **Bundled at:** `app/vendor/webOSTV.js`, loaded by `app/index.html` with a `<script>`
  tag before `js/bridge.js`.
- **Why bundled:** the TV platform does not inject `webOS.*`; every webOS TV app must
  load this library itself. Without it, `webOS.service` is undefined and the bridge to
  the Homebrew Channel service cannot work.
- **Provenance (retrieved 2026-09-14):**
  - Official download, LG webOS TV developer site:
    <https://webostv.developer.lge.com/assets/library/webOSTVjs-1.2.13.zip>
    (docs: <https://webostv.developer.lge.com/develop/references/webostvjs-introduction>)
  - Cross-checked byte-identical against the copy shipped inside the pinned
    `@webos-tools/cli@3.2.6` (the official `ares-*` toolchain in `devDependencies`) at
    `files/templates/tv-sdk-templates/bootplate-web/webOSTVjs-1.2.13/webOSTV.js`.
- **Version marker:** the library reports `webOS.libVersion === "1.2.13"`.
- **License:** Apache License 2.0 — full text bundled at
  `app/vendor/LICENSE-webOSTVjs.txt` (named `LICENSE-2.0.txt` in the official archive).
- **SHA256 (pinned; verify after any change):**
  - `app/vendor/webOSTV.js`:
    `2e83e028aef8651ef0b79b25a70c7ebc076a36781486a68623634bc0c2162670`
  - `app/vendor/LICENSE-webOSTVjs.txt`:
    `cb5e8e7e5f4a3988e1063c142c60dc2df75605f4c46515e776e3aca6df976e14`
- **Not bundled:** `webOSTV-dev.js` (the separate optional `webOSDev` extension) — this
  app only uses `webOS.service.request` and the `libVersion` marker.

## Domain-list data - furkan-bayrak/lg-tv-blocklist (CC BY 4.0)

- **Bundled at:** `app/filter/domains.json` (the committed per-domain row metadata) and
  the two preset filter inputs generated from it, `app/filter/filter-input-safe.txt`
  and `app/filter/filter-input-strict.txt`.
- **Why bundled:** the app blocks LG ad and telemetry domains at the DNS layer, and the
  list has to work offline on a fresh install, so the data ships inside the app rather
  than being fetched at runtime.
- **Provenance:** the domain metadata comes from the upstream project
  <https://github.com/furkan-bayrak/lg-tv-blocklist>.
- **Derivation:** the Safe and Strict presets are derived from the committed metadata in
  `app/filter/domains.json`; the generator `tools/build-filter-input.mjs` reads that
  file and records the upstream revision it was built from in each preset's header.
- **License:** Creative Commons Attribution 4.0 International (CC BY 4.0). The license
  text is not bundled; the canonical copy is at
  <https://creativecommons.org/licenses/by/4.0/legalcode>.
- **Attribution:** furkan-bayrak/lg-tv-blocklist, licensed CC BY 4.0.
