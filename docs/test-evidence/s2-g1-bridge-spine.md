# S2 hardware test — G1 bridge spine (0.2.0 install, hook, real status block)

> **Staged 2026-09-16.** All outputs below are captured verbatim from the live G1 during
> the operator window 11:13–11:20 CEST. The owner-round items (UI glance, cleanup,
> launch) are explicitly marked **PENDING / DEFERRED** — nothing here is inferred.

## Artifact under test (recorded 2026-09-16)

- CI run: `35087851277` — https://github.com/furkan-bayrak/lg-tv-blocklist-app/actions/runs/35087851277
  (success; tip `40bb91d`; `webosbrew-ipk-verify` pass)
- Artifact: `ipk` = `io.github.furkanbayrak.lgtvblocklist_0.2.0_all.ipk` (26 260 bytes) + `app.manifest.json`
- Local copy: `C:\wezterm_temp\opencode\s2-dist-ci\` (gitignored? no — kept OUTSIDE the repo;
  see Deviations for why not `dist-ci/`)
- sha256: `7f7d9694e9e3cbd9bf3ca8397b44eb2f6b5193ff2c3f48261a6220fe4b4ea8aa`
  — three-way MATCH: local `Get-FileHash` == CI `app.manifest.json` `ipkHash.sha256` == TV `sha256sum` (Step 2)
- Rollback artifact (S1): 0.1.0 sha256
  `3d32927f230d88d3c25eeaeb010d87eea0238a06d1e6c873c74141538b037eb8` — still present at
  `dist-ci/io.github.furkanbayrak.lgtvblocklist_0.1.0_all.ipk` (untouched)

Canonical header (filled during the test):

- Date: 2026-09-16 (operator window 11:13→11:20 CEST; TV clock = laptop clock, both CEST)
- Device: LG G1 `OLED55G19LA`, webOS `6.5.3-47` (same device as S0/S1)
- Network: home Fritz **guest** WLAN — TV `192.168.179.8`, laptop `192.168.179.2`
  (the plan's hotspot address `172.20.10.8` is dead; the network moved back to Fritz guest)
- App: io.github.furkanbayrak.lgtvblocklist **0.2.0**

## Observed results

### Step 0 — TV access + baseline (2026-09-16 11:13–11:14 CEST)

- `ping` 2/2 from 192.168.179.2; SSH root OK (`BatchMode=yes`).
- `date` = `Wed Sep 16 11:13:47 CEST 2026` → **year sane, TLS install safe** (no clock fix needed).
- Baseline `init.d` listing (7 hooks, **no** `50-lgtv-blocklist-app`):

```
-rwxr-xr-x 1 root root 2029 Sep 12 15:34 00-block-lg-hosts
-rwxr-xr-x 1 root root 1657 Sep  9 15:58 01-block-lan-discovery
-rwxr-xr-x 1 root root 6515 Sep 13 10:03 02-block-dns-egress
-rwxr-xr-x 1 root root 2535 Sep 12 16:27 03-block-lg-ip-egress
-rwxr-xr-x 1 root root 3818 Sep 16 10:12 04-sync-clock
-rwxr-xr-x 1 root root 2013 Sep  9 15:58 99-stop-services
-rwxr-xr-x 1 root root  280 Sep 12 09:51 inputhook
$ readlink /var/lib/webosbrew/init.d/50-lgtv-blocklist-app   → (empty) rc=1
$ ls -d .../applications/io.github.furkanbayrak.lgtvblocklist → APP-GONE
$ md5sum /etc/hosts                                          → a151aa271729756dd3fdc83d484691d7
$ ls -la /var/lib/webosbrew/                                 → init.d/ rollback/ sshd/ startup.sh only
$ ls -l /var/lib/webosbrew/lgtvblocklist-app.log             → LOG-ABSENT
```

- App info: the public bus **denies `getAppInfo` on this build**
  (`{"returnValue":false,"errorCode":-1,"errorText":"Denied method call \"getAppInfo\" for category \"/\""}`)
  → privileged `luna-send` used (same as S1's privileged `listApps`):
  `{"errorCode":1,"returnValue":false,"errorText":"Invalid appId specified OR Unsupported Application Type: io.github.furkanbayrak.lgtvblocklist"}`
  → app **absent** at baseline (expected).

### Step 1–2 — artifact + install (11:15–11:16 CEST)

- `gh run download 35087851277 -n ipk -D <temp>`; local sha256 (above) MATCH; manifest version `0.2.0` MATCH.
- Pushed to `/tmp/lgtvblocklist-0.2.0.ipk` (23 612-byte S1 leftovers in `dist-ci/` untouched).
- TV-side before install:
  `sha256sum /tmp/lgtvblocklist-0.2.0.ipk` = `7f7d9694e9e3cbd9bf3ca8397b44eb2f6b5193ff2c3f48261a6220fe4b4ea8aa` — **MATCH**.
- Install via **S1-proven procedure** `luna://com.webos.appInstallService/dev/install`
  (`luna-send-pub -i`, `subscribe:true`), states streamed:
  `"state":"installing"` (×2) → `"state":"installed"` (1 occurrence); the subscription's
  client was TERM-killed by `timeout -t 110` afterwards (expected; S1 saw the same hang).
- Post-install: app dir present; `appinfo.json` → `"version": "0.2.0"`; scripts dir contains
  `boot.sh` (984 B) **and the new `check.sh` (2729 B)**.

### Step 3 — version verify (11:16 CEST)

`luna-send -n 1 luna://com.webos.applicationManager/getAppInfo '{"id":"io.github.furkanbayrak.lgtvblocklist"}'`:

```json
{"appInfo":{...,"version":"0.2.0",...,"appDescription":"One-switch DNS blocking for rooted LG webOS TVs (companion to the lg-tv-blocklist project). Bridge + live status (S2); no blocking yet.","folderPath":"/media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist",...},"appId":"io.github.furkanbayrak.lgtvblocklist","returnValue":true}
```

- **Launch NOT performed** — owner directive: the app is not launched on screen until the
  owner round (plan Step 3 launch deferred; no `getForegroundAppInfo` capture in S2).

### Step 4 — boot hook registration via the app's exact fixed command (11:18 CEST)

Pre-flight (local, before shipping the TV script): the command string in the TV script was
proven **byte-equal** to what the compiled `app/js/bridge.js` sends
(`REGISTER BYTE-EQUAL: true`, `CHECK BYTE-EQUAL: true` — `node:vm` capture of both wrappers).

```sh
luna-send-pub -n 1 -f luna://org.webosbrew.hbchannel.service/exec '{"command":"mkdir -p /var/lib/webosbrew/init.d && chmod +x /media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist/scripts/boot.sh && ln -sf /media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist/scripts/boot.sh /var/lib/webosbrew/init.d/50-lgtv-blocklist-app"}'
```

Raw response: `{"returnValue": true, "stdoutString": "", "stderrString": ""}`.

Post-registration verify (raw):

```
$ readlink /var/lib/webosbrew/init.d/50-lgtv-blocklist-app
/media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist/scripts/boot.sh
$ stat -c 'mode=%a owner=%U:%G type=%F' /var/lib/webosbrew/init.d/50-lgtv-blocklist-app
mode=777 owner=root:root type=symbolic link
TARGET-EXISTS
```

**The 7 pre-existing hooks are byte-identical before/after** (md5, TV-observed both times):

| hook | md5 before == after |
|---|---|
| 00-block-lg-hosts | `4dfbbcf6df3c188a338e078dcf8af977` |
| 01-block-lan-discovery | `0c6e6eca1d95c2969bb72a039bbe78d3` |
| 02-block-dns-egress | `4da8bd686424c6d2291453064bce5599` |
| 03-block-lg-ip-egress | `50bd30dcf5e7fe22a8fd4e462d7250a0` |
| 04-sync-clock | `f2021d9f261bc38b49f7fd908194466b` |
| 99-stop-services | `11be0de91c606d14aad98963313abc52` |
| inputhook | `edaaada86db7c0313f18243940a49aaf` |

New symlink only; boot.sh md5 on TV `4804c7d5df60e9ac6a6824eea5afae23` == S1 value
(boot.sh unchanged in S2) == repo file (local `Get-FileHash` MD5 MATCH).

### Step 5 — real status block through HBC `/exec` (11:18–11:19 CEST)

Commands run exactly as the app does (`CMD_CHECK` byte-verified above).

**Pre-hook run (app installed, hook absent — extra run for the record, user-requested):**

```json
{"stdoutString":"@@STATUS-BEGIN\nschema=1\nts=1789550314\nhook=missing\nhook_target=none\nscripts=ok\n@@STATUS-END\n","returnValue":true,"stderrString":""}
```

**Post-hook run (the accepted capture; `returnValue: true`, stderr empty):**

```json
{"stdoutString":"@@STATUS-BEGIN\nschema=1\nts=1789550329\nhook=linked\nhook_target=/media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist/scripts/boot.sh\nscripts=ok\n@@STATUS-END\n","returnValue":true,"stderrString":""}
```

- Integrity: `stdoutBytes` (base64) decoded == `stdoutString` **byte-identical** (both runs).
- Rendered block is exactly 7 lines, ~183 bytes — far under the 204800-byte `/exec` cap.

### Step 6 — fixture + parser test

- Fixture: `tests/ts/fixtures/real-block-g1.txt` = the post-hook `stdoutString` **verbatim**
  (LF only, no CR, ends with LF, 183 bytes)
- sha256: `0c1900b74889dc76b0ad50a0d893aae22362c81bf4983aa33160364a5934fb63`
- `tests/ts/status.test.mjs` gained `parses the real G1 capture` (asserts `hook=linked`,
  `scripts=ok`, `ts>0` through the real compiled parser).
- `npm run build && npm run test:ts` → **20 tests, 20 pass, 0 fail** (15 parser + 4 bridge + 1 real capture).

### Step 7 — UI glance (HITL-lite)

**PENDING (owner round).** No launch, no screenshot, no glance this window — by owner directive
the app screen is first shown to the owner. The auto-refresh path the owner will see is
exactly the command captured in Step 5.

### Step 8 — log/perms + residue (no cleanup this window)

- `ls -l /var/lib/webosbrew/lgtvblocklist-app.log` → **LOG-ABSENT**. `check.sh` writes no
  files at all (the "status file root-only" discipline holds trivially this slice; no status
  file exists to check). The log appears only when `boot.sh` runs (next real boot / owner).
- `init.d` unchanged except the new symlink; `/var/lib/webosbrew` gains **nothing** new.
- `/etc/hosts` canary AFTER = `a151aa271729756dd3fdc83d484691d7` — **identical** to baseline.
- Residue inventory (intentionally LEFT for the owner round, cleanup deferred):
  1. app installed: `/media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist`
     (0.2.0, with `scripts/check.sh` md5 `df6bae8794c2e62182e68a69bf7cf1cd` == repo file)
  2. hook symlink: `/var/lib/webosbrew/init.d/50-lgtv-blocklist-app` → app `scripts/boot.sh`
  3. `/tmp/lgtvblocklist-0.2.0.ipk` (volatile `/tmp`; vanishes on reboot)
- **No removal, no uninstall performed** (owner directive: leave installed for the glance;
  cleanup is the owner round's step — the S1 T5 flow + the fixed `rm -rf` hook command are
  the referenced procedures).

## Deviations / anomalies recorded

1. **Network**: plan expected the phone hotspot (`172.20.10.8`) first; the TV is back on
   Fritz guest — used `192.168.179.8` (verified via ping + SSH before anything else).
2. **Artifact destination**: `gh run download … -D dist-ci` refused (stale S1
   `app.manifest.json` present; no overwrite flag used) → downloaded to
   `C:\wezterm_temp\opencode\s2-dist-ci` (outside the repo). S1 rollback artifacts in
   `dist-ci/` untouched.
3. **`getAppInfo` denied on the public bus** on this build → privileged `luna-send` used
   (same deviation S1 recorded for `listApps`).
4. **busybox `timeout` needs `-t`** (`timeout -t SECS`); the first install attempt
   (without `-t`) exited rc=127 with **no state change** (app dir absent + `getAppInfo`
   invalid after it — verified). Re-run succeeded.
5. **Install path** on TV: `/tmp/lgtvblocklist-0.2.0.ipk` (distinct name, so a stale
   `/tmp/lgtvblocklist.ipk` from S1 could never be mis-installed; sha256 verified TV-side
   immediately before install).
6. **Launch skipped** (owner directive; see Step 3) and **cleanup deferred** (owner
   directive; see Step 8) — both are plan Step 3/Step 8 items moved to the owner round.
7. **Extra pre-hook capture** performed (plan only required the post-hook capture);
   harmless read-only probe, kept for the record (Step 5).
8. The install subscription client hangs after `installed` (S1 behavior) — killed by
   TV-side `timeout -t 110`; completion independently re-verified (app dir + version).
9. **Local shell suite limited on Windows**: `npm run test:shell` under Git Bash/MSYS
   fails 3/8 cases — exactly the symlink-creation cases (`ln -s` "Operation not
   permitted" without Developer Mode; no WSL distro installed). Every case that does not
   need symlink privileges passed locally (5/8: missing dir, stub PATH, scripts missing,
   stderr empty, 7-line block). CI (ubuntu-24.04) is authoritative for the full 8/8 and
   re-runs on this commit's push (`test:ts` 20/20 also re-runs there including the real
   fixture test).

## Rollback pointer

- Reinstall the proven 0.1.0 artifact (sha256
  `3d32927f230d88d3c25eeaeb010d87eea0238a06d1e6c873c74141538b037eb8`, still in `dist-ci/`) or
  rebuild from the S1 tip `970e3fb`; remove the hook with the app's fixed `rm -rf` command
  (or uninstall via the S1 T5 procedure; both are the owner-round cleanup steps anyway).
- S2 made **no DNS / hosts / firewall changes** (hosts md5 and all hook md5s unchanged);
  the only TV artifacts are the app + the symlink.

## Disclosure

Development of this app is AI-assisted; builds are reproducible in CI and every hardware
result above was produced on a real TV by the repo owner.
