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

- Date: 2026-09-15 (operator part 11:32→11:59 CEST; TV clock = laptop clock, both CEST)
- Device: LG G1, model `OLED55G19LA` (board `O20_DVB`), webOS release `6.5.3-47`
  (build 2025-09-13; source: TV `/var/run/nyx/device_info.json` + `os_info.json`)
- App: io.github.furkanbayrak.lgtvblocklist 0.1.0
- IPK: io.github.furkanbayrak.lgtvblocklist_0.1.0_all.ipk (23 612 bytes)
- sha256: `3d32927f230d88d3c25eeaeb010d87eea0238a06d1e6c873c74141538b037eb8`
  — re-verified on the TV at step 2: **MATCH** (local `Get-FileHash` also MATCH)
- Built by: GitHub Actions run 34843186641 (ubuntu-24.04; webosbrew-ipk-verify: pass)

## Observed results

### Operator-side (AFK), 2026-09-15 11:32–11:40 CEST

**Step 1 — pre-flight (recorded):**

- SSH: `ssh-ok`; TV `uptime` 10 min at 11:32:22 CEST.
- `init.d` listing: `00-block-lg-hosts`, `01-block-lan-discovery`, `02-block-dns-egress`,
  `03-block-lg-ip-egress`, `99-stop-services`, `inputhook` — **no `50-lgtv-blocklist-app`**
  (expected, hook registration is a later step).
- `/etc/hosts` md5 = `a151aa271729756dd3fdc83d484691d7` (**canary BEFORE**).
- `/media/developer/apps/usr/palm/applications/` present (NO-DEVELOPER-DIR did not appear);
  pre-existing apps only (`com.retroarch.webos`, `org.webosbrew.hbchannel`,
  `org.webosbrew.inputhook`, `youtube.leanback.v4`).

**Step 2 — push + sha256 before install (TV-side):**

- `/tmp/lgtvblocklist.ipk`, 23 612 bytes.
- `sha256sum /tmp/lgtvblocklist.ipk` =
  `3d32927f230d88d3c25eeaeb010d87eea0238a06d1e6c873c74141538b037eb8` — **MATCH** with the
  CI artifact hash (step 2 gate PASS).

**Step 3 — install (`luna://com.webos.appInstallService/dev/install`):**

Command (run-sheet exact mechanism):

```sh
luna-send-pub -i 'luna://com.webos.appInstallService/dev/install' '{"id":"com.ares.defaultName","ipkUrl":"/tmp/lgtvblocklist.ipk","subscribe":true}'
```

Subscription opened (`{"subscribed":true,"returnValue":true}`); states streamed:
ipk verifying → ipk parsing → app closing → installing → service installing → final
`"state":"installed"`. Final captured line:

```json
{"id":"com.ares.defaultName","statusValue":30,"details":{"receivedSize":"0","packageId":"io.github.furkanbayrak.lgtvblocklist","modifiedTime":"","unpackFileSize":"91455","client":"com.webos.lunasendpub-3494","totalSize":"0","verified":false,"progress":100,"installBasePath":"/media/developer","downgrade":true,"paused":false,"permissionLevel":"none","simpleStatus":"install","state":"installed","pkgType":"","update":false,"ipkFile":"/tmp/lgtvblocklist.ipk"}}
```

Minor deviation (no impact): `luna-send-pub -i` does not exit after `installed` (subscription
stays open); the client session was closed after capture. Install completed before close —
independently re-verified below.

**Install verified (installation check):**

- App dir present: `/media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist`
  (84 KB), files: `appinfo.json`, `css/app.css`, `icon.png`, `index.html`, `js/bridge.js`,
  `js/main.js`, `largeIcon.png`, `scripts/boot.sh`, `vendor/webOSTV.js`,
  `vendor/LICENSE-webOSTVjs.txt` — **vendored `webOSTV.js` present in the installed tree**
  (the T5 launch watch item's prerequisite).
- `appinfo.json`: id `io.github.furkanbayrak.lgtvblocklist`, version `0.1.0`,
  title `LG TV Blocklist`, `main` `index.html`, `type` `web`.
- `luna://com.webos.applicationManager/listApps` (privileged `luna-send`; the public bus
  denies `listApps`) → app listed: `"title":"LG TV Blocklist"` + id
  `io.github.furkanbayrak.lgtvblocklist`.
- Post-install canaries: `/etc/hosts` md5 **unchanged** (`a151aa2717…`); no `blocklist`
  entry in `init.d`; `mount` shows the same `tmpfs on /etc/hosts`.

**Step 4 — launch (operator-side SSH path per plan Task 5 Step 4, "optional … for the record"):**

- `luna-send -n 1 luna://com.webos.applicationManager/launch '{"id":"io.github.furkanbayrak.lgtvblocklist"}'`
  → `{"returnValue":true}`.
- 4 s later `luna://com.webos.applicationManager/getForegroundAppInfo` →
  `{"appId":"io.github.furkanbayrak.lgtvblocklist","returnValue":true,...}` — the app is the
  foreground app (window up).

**Deviations / anomalies recorded:**

- `getForegroundAppInfo` shows empty `windowId`/`processId` strings (API shape on this
  build); the `appId` foreground value is the launch evidence.
- `luna://com.webos.service.tv.systemproperty/getSystemInfo` hangs on this TV (killed by
  `timeout`, rc=143); device data taken from `/var/run/nyx/*.json` instead.

### Operator-side (AFK), 2026-09-15 11:44–11:45 CEST — steps 6–8 (hook verify + proof run + canary)

**Step 6 — symlink + `boot.sh` verification (after owner registration):**

```
$ ls -l /var/lib/webosbrew/init.d/
lrwxrwxrwx 1 root root 96 Sep 15 11:42 50-lgtv-blocklist-app -> /media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist/scripts/boot.sh
$ readlink /var/lib/webosbrew/init.d/50-lgtv-blocklist-app
/media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist/scripts/boot.sh
$ stat -c 'mode=%a owner=%U:%G type=%F' /var/lib/webosbrew/init.d/50-lgtv-blocklist-app
mode=777 owner=root:root type=symbolic link
```

- Exactly **one** `blocklist` entry in `init.d`; symlink root-owned; target exists
  (`TARGET-EXISTS`; 984 B, mode 755, owner `1001:1001` — the app-dir build/install user).
- No other `init.d` change vs pre-flight (same 6 hand-built hooks, same sizes/dates).
- `boot.sh` content: S1 skeleton — appends to `/var/lib/webosbrew/lgtvblocklist-app.log`
  (`exec >> … 2>&1`), prints one `boot hook ran (S1 skeleton)` line, resolves its own path
  for later slices, always `exit 0` (documented: never blocks TV startup).
  `md5sum` = `4804c7d5df60e9ac6a6824eea5afae23`.

**Step 7 — hook proof run (run-sheet-directed, rc=0 watch item):**

```
$ sh /var/lib/webosbrew/init.d/50-lgtv-blocklist-app; echo rc=$?; tail -n 3 /var/lib/webosbrew/lgtvblocklist-app.log
rc=0
2026-09-15 11:44:50 boot hook ran (S1 skeleton)
```

- **rc=0** + fresh timestamped log line; log file created at
  `/var/lib/webosbrew/lgtvblocklist-app.log` (48 B, root, 11:44).

**Step 8 — no-writes canary (AFTER):**

- `/etc/hosts` md5 `a151aa271729756dd3fdc83d484691d7` — **identical** to canary BEFORE.
- Mounts: `tmpfs on /etc/hosts type tmpfs (rw,relatime)` — unchanged; `/etc/resolv.conf`
  is a plain symlink (`-> /var/lib/misc/resolv.conf`), not a bind mount (same as before).
- New paths this block: symlink + log file (+ app dir from install). Nothing else new in
  `/var/lib/webosbrew` (`init.d/`, `rollback/`, `sshd/`, `startup.sh`, log file only).

### Operator-side (AFK), 2026-09-15 11:57–11:59 CEST — recovery pass: remove-hook + uninstall state verify (steps 9–10)

> Context: the first pass at steps 9–11 was interrupted by a laptop-side network outage.
> Nothing about the current state was assumed — every item below was re-verified fresh at
> 11:57–11:59 CEST (TV clock = laptop clock).

**Step 0 — state check (entry point):**

- SSH OK: `ssh-ok`; `uptime` 35 min; `date` = `Tue Sep 15 11:57:33 CEST 2026`.
- Symlink: **GONE** — `readlink /var/lib/webosbrew/init.d/50-lgtv-blocklist-app` prints
  nothing, **rc=1**; `init.d` mtime `Sep 15 11:46` (removed during the interrupted attempt,
  consistent with the owner's "Remove boot hook" press; the UI response text itself was not
  captured).
- App: **ALREADY UNINSTALLED** — app dir absent (`APP-GONE`), applications-dir mtime
  `Sep 15 11:48`; `listApps` contains no blocklist entry (`NOT-IN-LISTAPPS`);
  `find /media/developer -name "*lgtvblocklist*" -o -name "*furkanbayrak*"` → empty.
  → per the run-sheet skip rule, `dev/remove` was **not re-issued**; the uninstall itself
  completed during the interrupted attempt (≈11:48).

**Step 9 verify — remove-hook (raw):**

```
$ ls -la /var/lib/webosbrew/init.d/
-rwxr-xr-x 1 root root 2029 Sep 12 15:34 00-block-lg-hosts
-rwxr-xr-x 1 root root 1657 Sep  9 15:58 01-block-lan-discovery
-rwxr-xr-x 1 root root 6515 Sep 13 10:03 02-block-dns-egress
-rwxr-xr-x 1 root root 2535 Sep 12 16:27 03-block-lg-ip-egress
-rwxr-xr-x 1 root root 2013 Sep  9 15:58 99-stop-services
-rwxr-xr-x 1 root root  280 Sep 12 09:51 inputhook
                                                        → NO 50-lgtv-blocklist-app
$ readlink /var/lib/webosbrew/init.d/50-lgtv-blocklist-app; echo readlink-rc=$?
readlink-rc=1
$ ls -l /var/lib/webosbrew/init.d/ | grep blocklist || echo NO-HOOK
NO-HOOK
md5s: 00=4dfbbcf6df3c188a338e078dcf8af977  01=0c6e6eca1d95c2969bb72a039bbe78d3
      02=4da8bd686424c6d2291453064bce5599  03=50bd30dcf5e7fe22a8fd4e462d7250a0
      99=11be0de91c606d14aad98963313abc52  inputhook=edaaada86db7c0313f18243940a49aaf
```

- All six hand-built hooks unchanged (same sizes/dates as pre-flight; **02** matches the
  2026-09-13 autodetect value `4da8bd68…`, **03** matches the 2026-09-12 value `50bd30dc…`).
- No dangling leftovers: no symlinks in `init.d`; nothing points into the (now gone) app dir.

**Step 10 verify — APP-GONE + NO-HOOK + no-writes canary (raw):**

```
$ ls -d …/applications/io.github.furkanbayrak.lgtvblocklist 2>/dev/null || echo APP-GONE
APP-GONE
$ ls -la /media/developer/apps/usr/palm/applications/     (dir mtime Sep 15 11:48)
com.retroarch.webos  org.webosbrew.hbchannel  org.webosbrew.inputhook  youtube.leanback.v4
                                                        (only the 4 pre-existing apps)
$ luna-send -n 1 luna://com.webos.applicationManager/listApps | grep -i -E 'blocklist|furkanbayrak'
NOT-IN-LISTAPPS
$ md5sum /etc/hosts
a151aa271729756dd3fdc83d484691d7  /etc/hosts             (canary AFTER — identical)
$ mount | grep -E "hosts|resolv"
tmpfs on /etc/hosts type tmpfs (rw,relatime)             (unchanged; no resolv mount, same as before)
```

**Leftover scan + directed cleanup:**

- `/var/lib/webosbrew/` before cleanup: only extra item = `lgtvblocklist-app.log` (48 B, root,
  Sep 15 11:44) → removed per run-sheet step 10: `rm -f …` → **rm-rc=0, LOG-GONE**;
  final listing = `init.d/`, `rollback/`, `sshd/`, `startup.sh` only (stock).
- Remaining non-stock artifact: `/tmp/lgtvblocklist.ipk` (23 612 B, 11:32) — volatile `/tmp`,
  not directed for removal by the run-sheet; left in place (will vanish on next reboot). Noted.

**Verdict:** steps 9–10 verify **PASS**; **Gate B satisfied** (APP-GONE + NO-HOOK; hosts md5
unchanged; no `50-lgtvblocklist-app` left; TV stock). Step 11 owner Netflix sanity was not
captured in this pass (owner-side; non-blocking for Gate B).

### Owner observations (HITL — recorded 2026-09-15 ≈11:42 CEST)

- **Step 4 (screen):** launch status line not separately captured — recorded **inferred**:
  the owner proceeded to a successful "Check bridge" call, which requires `webOSTV.js` to
  have loaded; "Bridge unavailable" was not observed.
- **Step 5 — "Check bridge (root)" JSON (owner-captured, verbatim):**
  `{"returnValue":true,"root":true,"homebrewBaseDir":"/media/developer/apps","telnetDisabled":true,"failsafe":false,"sshdEnabled":true,"blockUpdates":true}`
  → PASS (`"root": true` + `homebrewBaseDir` present).
- **Step 6 — "Show boot hook" (before register, owner-captured):**
  `returnValue: false` + `errorText: Command failed: readlink /var/lib/webosbrew/init.d/50-lgtv-blocklist-app`
  → shown as `Boot hook: (none)` — correct (no hook registered yet).
- **Step 6 — "Register boot hook" (owner-captured):** `returnValue: true` →
  `Boot hook now: /media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist/scripts/boot.sh`.
- **Step 9:** "Remove boot hook" — performed during the interrupted attempt (init.d mtime
  11:46; the UI response text itself was not captured). Removal operator-verified: symlink
  GONE (`readlink` rc=1); init.d back to the six hand-built hooks (md5s in the recovery-pass
  section above).
- **Step 11:** Netflix sanity after uninstall — owner-side; **not captured this pass** (the
  session was interrupted; no trace operator-side). Non-blocking for Gate B; recommend the
  owner confirm during the Block 2 smoke.

## Disclosure

Development of this app is AI-assisted; builds are reproducible in CI and every hardware
result above was produced on a real TV by the repo owner.
