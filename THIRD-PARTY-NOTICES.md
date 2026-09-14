# Third-party notices

The packaged app bundles the component below. Everything else in this repository is
first-party (MIT — see `LICENSE`).

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
