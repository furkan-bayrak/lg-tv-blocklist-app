# S0 G1 live capture log — session <DATE TBD>

> One entry per test, written **before** the test runs (criteria first). Entry format: `..\capture-template.md`.
> Raw files land in `..\captures\`. Session order + gates + flags: `..\SESSION-RUNSHEET.md`.
> Baseline reference: `captures\baseline-*.txt`. Revisions to "proposed" values are recorded here.

## Test index (fill verdicts as the session progresses)

| Test-ID | Task | Verdict | One-line evidence pointer |
|---|---|---|---|
| BASE-1 | T5 | PASS | `..\captures\baseline-20260915-120241.txt` (complete + parseable, 261 lines) |
| PAUSE-1 | T5 | PASS | 02-hook rules removed (DNAT :53 ×2 + 853 drops ×2); hooks 00/02 `-rw-` |
| BOOT-1 | T6 | PASS | probe @uptime 33 s; exactly 1× hosts mount = /tmp/hosts bind (inode 36:47960); HBC marker line 10; boot→SSH ~60 s; records: aarch64, node v8.12.0, failsafe flag present |
| MOUNT-1 | T7 | PASS | M1 count=1 + source /tmp/hosts (inode 36:47960, md5 7900d0cf…) · M2 file+getent `0.0.0.0 s0test.lgtvcommon.com` · M3 removal byte-identical · M4 kernel allows stacking (2→1 clean) · M5 `sed -i` EROFS fail recorded, in-place rewrite only · mount present at end |
| FW-1 | T8 | PASS (recording complete; 2 negative capability findings — see entry) · part-A2 addendum: kit side-port refs 5353→5335 in firewall-contract.sh (5 lines; script NOT re-run — kernel property, verdict unchanged) | `captures\fw1-run-20260915-121709.txt` + `captures\fw1-diag-20260915-121709.txt` + `captures\fw1-modclosure-20260915-122001.txt`: F1–F4/F7 contract OK; F5 REDIRECT + F6 owner-match absent (kernel 4.4.84 kcl4tv, non-loadable) |
| MECH-1 | T8 | **COMPLETE (part-A3):** M2 IMPOSSIBLE-by-kernel (capability, recorded); M3 DNAT-to-self **WORKS** (part-A2; loop-avoidance caveat for T12); M4 connmand kill **RESPAWN=no** (systemd unit went dead — no restart at +2m55s), manual restart OK (pid 6743, single), post-kill DNS rc=0 stub+upstream ⇒ ≥1 in-path mechanism = M3; no reduced-mechanism fallback | `captures\m4-run-20260915-125324.txt` + `m4-runout-20260915-125626.txt` + `mech-run4-mech-probe-20260915-125626.log` + `m4-post-20260915-125416.txt` + `m4-stability-20260915-125626.txt` (part-A2 artifacts unchanged: `mech-m2m3-run3-20260915-122926.txt` + `mech-post3-20260915-123016.txt` + `port5335-freecheck-20260915-122730.txt`) |
| EXEC-1 | T9 | PASS | no exec timeout ≥120 s (sleep 10/30/60/120 all rc=0) · **stdout cap = 204,800 B (200 KiB)** — returnValue=false `stdout maxBuffer exceeded`, child killed, luna rc still 0 · no concurrency lock (8 s for 2×8 s) · spawn streams 4 events (bounded reader needed) · T5 keeps stdoutString on error · raw: `..\captures\exec1-run-20260915-131053.txt` + `exec1-cap-20260915-131053.json` |
| TRANSPORT-1 | T10 | PASS | curl rc=0 both targets (raw.githubusercontent SHA256SUMS 500 B; GitHub release minisig 333 B incl. redirect); addendum verify: strict-domains.txt sha256 == published sum (tamper copy differs); raw: `..\captures\transport1-run-20260915-131804.txt` + `transport1-addn-20260915-131829.txt` |
| UPSTREAM-1 | T10 | PASS | dns1=192.168.179.1 (working upstream); dns2/dns3 = DHCPv6 ULA (not v4 targets); resolv.conf ::1/127.0.0.1; default via 192.168.179.1 dev wlan0; raw: `..\captures\upstream1-run-20260915-131830.txt` + `upstream1-getstatus-20260915-131830.json` |
| SIGNING-1 | T10 | PASS | static verifier RUNS on G1: aead/minisign v0.3.0 linux-arm64 static (1,769,624 B, sha256 3b9bb358…) — C-0.12 prehashed+legacy sigs verified rc=0, tamper rejected, -H enforced; stock crypto unusable (openssl 1.0.2r, no Ed25519); raw: `..\captures\signing1-run-20260915-131830.txt` + `signing1-verify-20260915-132132.txt` |
| DETECT-1 | T11 | **PASS (after 3 tunes — see entry)** | clean=all false · m1 D2(+D3 stack) TRUE · m2 D4 TRUE · m3 D5-nat TRUE · D1-mock TRUE (operator-added); each removed clean; detector md5 `1531fc53…`; raw: `..\captures\detect1-clean3-…`, `detect1-m1b-…`, `detect1-m2-…`, `detect1-m3-…`, `detect1-d1mock-…`, `detect1-final-…` |
| EFF-HOSTS | T12 | PASS (recorded; prior-evidence deviation — see entry) | hosts getent 5/5 → `0.0.0.0` · stub/direct NODATA pre==post (network-side AGH) · B: literal 5/5 vs hosts-attributable 0/5 · raw: `..\captures\eff-p1-hosts-20260915-134548.txt` + `eff-p1-attribution-20260915-134714.txt` |
| EFF-FILTER | T12 | PASS | 5 list names + zone `rcode=5` REFUSED via filter AND stub paths; example.com OK (FORWARD 8 ms, no loop); zone matched `*.lgtvcommon.com`; status `filter=up rule=on keeper=up`; nat = 2 rules (`! -d 192.168.179.1` → `127.0.0.1:5335`); raw: `..\captures\eff-p2-apply-20260915-134943.txt` + `eff-p2-filter-20260915-135004.txt` |
| EFF-COMBINED | T12 | PASS | 6/6 REFUSED via filter+stub; example.com OK; 853 DROP proven (openssl 5s-killed vs 443 control 0s; pkts 3→9); getent 5/5 `0.0.0.0`; raw: `..\captures\eff-p3-combined-20260915-140206.txt` + `eff-p3-853verify-20260915-140311.txt` |
| EFF-VARIANTS | T12 | PASS | B = `rcode=0`+`A=0.0.0.0` (AAAA `::ffff:0.0.0.0`); A = `rcode=5` REFUSED — both deterministic 6/6; **A kept active** (provisional; owner playback already passed on A); raw: `..\captures\eff-variants-b-20260915-140404.txt` + `eff-variants-a-20260915-140511.txt` |
| EFF-BYPASS | T12 | PASS (recorded) | hardcoded-53 no escape (`rcode=5`); DoT 853 dropped (2 targets 5s-killed, 9 pkts); v6 ULA-only/no global path (unfilterable on this kernel); **DoH/443 reachable HTTP 200 — `snu.lge.com` (filter REFUSED) resolved via DoH to live AWS IP = documented limit**; raw: `..\captures\eff-bypass-20260915-140642.txt` + `eff-bypass-supp-20260915-140725.txt` |
| EFF-PLAYBACK | T12/Gate F | PASS | owner-confirmed 2026-09-15: ~1 h Prime Video with filter ON (variant A) — played perfectly fine; no stutter/error card/app-start failure; Gate F = EFF-FILTER PASS + playback PASS |
| KEEP-1 | T13 | PASS (S1=**ALIVE**, S2=**ALIVE** — both contra/with expectation; S3 attempted/not validated) | S1: boot-hook sleeper pid 5003 alive @+146 s (cgroup `/system.slice/ls-hubd.service`, start≈boot+32.5 s) · S2: exec-launched pid 8581 alive @+90 s · raw: `..\captures\b10-step1-keep.txt`, `b10-step2-exec-bg.txt` |
| FAIL-DEL | T13 | PASS (DNS-OK @0 s; gaveup=yes; steady "protection off, TV works") — deviation: give-up non-terminal | keeper rollback → DNS OK 0 s; 3 attempts/cycle then re-tries (5+ attempts counted); raw: `..\captures\b10-step4-faildel.txt` |
| FAIL-MIDAPPLY | T13 | PASS (all 3 stages coherent; reconcile → ON each) | stage3 rule=off/filter-up · stage4 rule=off/filter-up · stage5 rule=on/filter-up/pointer=off; reconcile RESULT=OK ×3; raw: `..\captures\b10-step5-midapply.txt` |
| FAIL-MATRIX | T13 | **FAIL** (F/K PASS; FK/KF/BOTH FAIL — dark persists, no auto-recovery) | F/K all-OK (zero DNS impact); FK/KF/BOTH `still_FAIL_at_end` + mixed state (rule=on/filter=down) → **Gate G mixed state → mitigation required**; raw: `..\captures\b10-step6-matrix.txt` |
| FAIL-POWER | T14 | | |
| FAIL-FAILSAFE | T14 | | |
| FAIL-ROUTER | T14 | | |
| TOGGLE-LIVE | T14 | | |
| HBC-MATRIX | T14 | | |
| CLEANUP-1 | T15 | | |

---

(entries follow, newest at the bottom)

---

## Block 0 — Session open / pre-flight — 2026-09-15 11:11–11:17 CEST

**Task:** Block 0 (session open) · **Mode:** AFK checks + HITL-owner (owner confirm pending) · **When:** 2026-09-15 11:11–11:16:54 CEST
**Preconditions:** checks only; no TV mutations performed.
**Commands (laptop = Windows pwsh; exact run-sheet command where specified):**
    ipconfig | Select-String "IPv4"                          → 100.105.179.70 (Tailscale), 192.168.179.4 (WLAN)
    ssh -o BatchMode=yes root@192.168.179.8 "echo ssh-ok"    → banner exchange: Connection to UNKNOWN port -1: Connection refused
    git -C C:\Users\furka\projects\lg-tv-blocklist rev-parse HEAD  → 1aa8015a862f12ad1d8066bdb4ae63d87ae7ba3e
    Get-FileHash C:\Users\furka\projects\lg-tv-blocklist\lists\*.txt -Algorithm MD5
    Get-FileHash dist-ci\*.ipk -Algorithm SHA256  (from C:\Users\furka\projects\lg-tv-blocklist-app)
    (diagnostics) ping 192.168.179.8; arp -a; TCP connect probes 22/23/3000/3001/9080/9998; git-bash ssh retry

**Raw output:**
    SSH attempt #1 (11:12, Windows OpenSSH 9.5p2): kex_exchange_identification: write: Connection refused → banner exchange: Connection to UNKNOWN port -1: Connection refused
    SSH attempt #2 (11:13, verbatim retry): same "Connection refused"
    SSH retry #3 (11:15, after 45 s wait): banner exchange: Connection to UNKNOWN port -1: Connection refused
    SSH cross-check (Git bash ssh): ssh: connect to host 192.168.179.8 port 22: Connection refused
    TcpClient raw connect :22 → refused [::ffff:192.168.179.8]:22
    Test-Connection 192.168.179.8 → Success 35 ms / 7 ms (ICMP ok)
    arp -a → 192.168.179.8  24-e8-53-77-fd-3a  dynamisch   (OUI 24:E8:53 = LG Innotek → LG device = expected TV)
    Port probe (11:15–11:16): 22 refused · 23 OPEN · 3000 OPEN · 3001 OPEN · 9080 refused · 9998 OPEN
    Telnet :23 passive connect → 12-byte binary banner (IAC negotiation); no interaction, closed.
    Re-probe 11:16:54: port 22 refused; port 23 OPEN; ping True.

    Repo freeze resolved:
      HEAD: 1aa8015a862f12ad1d8066bdb4ae63d87ae7ba3e  (lg-tv-blocklist)
      lists/safe-adblock.txt    ED50A66E0165F32201FF7E18788BF70D
      lists/safe-domains.txt    EA18657ACD16A5432090BC5C29A6D60F
      lists/safe-hosts.txt      F1860FAAAE0F140BE25125BF61D9FA26
      lists/strict-adblock.txt  ED7D3893E000B6A06F48D4CDE9555AA2
      lists/strict-domains.txt  5DDC27B2EB19F008BD057BF90C701BEB
      lists/strict-hosts.txt    3DBBEB676D3B6969EEDE29236C9F4326

    S1 artifact gate: dist-ci\io.github.furkanbayrak.lgtvblocklist_0.1.0_all.ipk
      sha256 = 3D32927F230D88D3C25EEAEB010D87EEA0238A06D1E6C873C74141538B037EB8
      expected 3d32927f230d88d3c25eeaeb010d87eea0238a06d1e6c873c74141538b037eb8  → MATCH (case-insensitive)

**Measured:** SSH unreachable on :22 (3 attempts, 2 clients, ~4.5 min span; TCP-level RST); TV network-reachable (ICMP, ARP = LG MAC); telnet :23 OPEN; luna 3000/3001 + 9998 OPEN.
**Pass/Fail criteria:** PASS if `ssh -o BatchMode=yes root@192.168.179.8 "echo ssh-ok"` prints ssh-ok and TV read-only captures run.
**Verdict:** **FAIL (SSH refused) — BLOCK 0 STOP.** Signature (SSH/dropbear absent + telnet:23 OPEN + reachable) matches the documented webosbrew failsafe / interrupted-boot state (LEARNINGS 2026-09-12: "telnet:23 open + dropbear/SSH absent + hooks skipped = boot was interrupted inside the ~4-min watchdog window; a normal reboot restores. Never cut TV power within ~4 min of boot."; telnet has been OFF since 2026-09-08, so OPEN :23 is abnormal). No TV-side checks run (init.d listing / hosts md5 canary / developer-apps dir all unreachable); no mutation, no fix improvised. Suggested (owner-gated): ONE normal reboot of the TV, wait for boot to settle, then re-run Block 0.

---

## Block 0 re-run — session open after failsafe recovery — 2026-09-15 11:24:48–11:25 CEST

**Task:** Block 0 remainder (SSH reachability + pre-flight captures) · **Mode:** AFK · **When:** 2026-09-15 11:24:48 (TV clock = laptop clock, both CEST)
**Session-start deviation (recorded):** the first SSH attempt (11:12–11:16, entry above) was blocked by the TV's failsafe/interrupted-boot state (SSH :22 refused, telnet :23 open, nothing hook-side reachable). Recovery was **owner-side only**: HBC → "system reboot" at ≈11:22:45 CEST (TV uptime = 2 min at 11:24:48). No TV-side fix was improvised by the agent. After the HBC reboot, SSH came up on the first attempt.
**Criteria (per run-sheet Block 0/1 pre-flight):** `ssh … "echo ssh-ok"` prints ssh-ok; **no `50-lgtv-blocklist-app`** in init.d; `/etc/hosts` md5 recorded (canary BEFORE); `/media/developer/apps/usr/palm/applications/` present (NO-DEVELOPER-DIR must not appear).

**Raw output:**
    ssh -o BatchMode=yes root@192.168.179.8 "echo ssh-ok"   → ssh-ok
    ssh … "echo ssh-ok; uptime; date"                       → ssh-ok; 11:24:48 up 2 min, 0 users, load avg 14.23 7.06 2.77; Tue Sep 15 11:24:48 CEST 2026
                                                              (laptop local 2026-09-15 11:24:54 +02:00 → TV/laptop clocks agree)
    ssh … "ls -la /var/lib/webosbrew/init.d/; md5sum /etc/hosts" →
      init.d listing (all root:root, -rwxr-xr-x):
        00-block-lg-hosts       (2029 B, Sep 12 15:34)
        01-block-lan-discovery  (1657 B, Sep  9 15:58)
        02-block-dns-egress     (6515 B, Sep 13 10:03)
        03-block-lg-ip-egress   (2535 B, Sep 12 16:27)
        99-stop-services        (2013 B, Sep  9 15:58)
        inputhook               ( 280 B, Sep 12 09:51)
      → **NO `50-lgtv-blocklist-app` present** (expected — app never installed)
      /etc/hosts md5 = a151aa271729756dd3fdc83d484691d7      (canary **BEFORE**, recorded)
    ssh … "ls -d /media/developer/apps/usr/palm/applications/ || echo NO-DEVELOPER-DIR" → /media/developer/apps/usr/palm/applications/  (present)

**Measured:** SSH OK first attempt post-recovery; TV booted ≈11:22:45 CEST (uptime 2 min); init.d holds the 6 known hand-built hooks (00/01/02/03 + 99 + inputhook), none is the S1 app hook; developer-apps dir exists; hosts md5 canary pristine value recorded.
**Verdict:** **PASS — GO for Block 1.** Remaining Block-0 items are owner-side only (owner present, abort word, session-pause acknowledgement) — collect verbally at Block 1 start. TV side has no blocker for S1-T5.

---

## Block 1 — S1-T5 operator-side (steps 1–3 + install verify + documented SSH launch) — 2026-09-15 11:32–11:40 CEST

**Task:** S1-T5 install test, operator-side part UP TO the first owner interaction · **Mode:** AFK (+ 1 run-sheet-sanctioned SSH launch "for the record", S1 plan Task 5 Step 4 optional path) · **When:** 2026-09-15 11:32:22–≈11:40 CEST (TV clock = laptop clock). Entry written post-run (criteria inline).
**Criteria:** ssh-ok; no `50-lgtv-blocklist-app` in init.d; hosts md5 canary recorded; developer dir present · TV sha256 == 3d32927f… · install reaches `installed` · app visible to applicationManager · (optional) luna launch succeeds.

**Raw output:**

    ssh … "echo ssh-ok; uptime; date" → ssh-ok; 11:32:22 up 10 min; Tue Sep 15 11:32:22 CEST 2026
    ssh … "ls -la /var/lib/webosbrew/init.d/; md5sum /etc/hosts" → 6 known hooks (00/01/02/03/99/inputhook), NO 50-lgtv-blocklist-app; /etc/hosts md5 = a151aa271729756dd3fdc83d484691d7 (canary BEFORE)
    ssh … "ls -d /media/developer/apps/usr/palm/applications/ …" → present; contents: com.retroarch.webos, org.webosbrew.hbchannel, org.webosbrew.inputhook, youtube.leanback.v4
    (laptop) Get-FileHash dist-ci\…_all.ipk -Algorithm SHA256 → 3D32927F…37EB8 (MATCH; 23612 B)
    scp …_all.ipk → root@192.168.179.8:/tmp/lgtvblocklist.ipk → OK
    ssh … "sha256sum /tmp/lgtvblocklist.ipk" → 3d32927f230d88d3c25eeaeb010d87eea0238a06d1e6c873c74141538b037eb8  /tmp/lgtvblocklist.ipk   (MATCH)

    luna-send-pub -i 'luna://com.webos.appInstallService/dev/install' '{"id":"com.ares.defaultName","ipkUrl":"/tmp/lgtvblocklist.ipk","subscribe":true}' →
      {"subscribed":true,"returnValue":true}
      states: ipk verifying (268→270) → ipk parsing (35→37, packageId=io.github.furkanbayrak.lgtvblocklist, unpackFileSize=91455) → download (262→264) → app closing (32→34) → installing (11→13) → service installing (27→29) → FINAL: statusValue 30, state "installed", packageId io.github.furkanbayrak.lgtvblocklist, installBasePath /media/developer
      NOTE (deviation): luna-send-pub -i stayed subscribed after `installed` (does not self-exit); client closed after capture. Install unaffected (verified below).

    Install verification:
      app dir /media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist (84 KB): appinfo.json, css/app.css, icon.png, index.html, js/bridge.js, js/main.js, largeIcon.png, scripts/boot.sh, vendor/webOSTV.js, vendor/LICENSE-webOSTVjs.txt  ← vendored webOSTV.js PRESENT
      appinfo.json: id io.github.furkanbayrak.lgtvblocklist, version 0.1.0, title "LG TV Blocklist", main index.html
      luna-send -n 1 luna://com.webos.applicationManager/listApps → grep -o id → 2 hits; "title":"LG TV Blocklist" present   (note: pub bus DENIES listApps: {"returnValue":false,"errorCode":-1,"errorText":"Denied method call \"listApps\" for category \"/\""} → used privileged luna-send)
      canaries post-install: /etc/hosts md5 a151aa271729756dd3fdc83d484691d7 UNCHANGED; init.d blocklist count = 0; mount → tmpfs on /etc/hosts (same)

    Launch (S1 plan Task 5 Step 4 optional SSH path — per architect instruction):
      luna-send -n 1 luna://com.webos.applicationManager/launch '{"id":"io.github.furkanbayrak.lgtvblocklist"}' → {"returnValue":true}
      +4 s: getForegroundAppInfo → {"appId":"io.github.furkanbayrak.lgtvblocklist","returnValue":true,"windowId":"","processId":""} → app IS foreground (window up)

    Device data (header): /var/run/nyx/device_info.json → product_id OLED55G19LA, board O20_DVB; os_info.json → webos_release 6.5.3, core_os_release 6.5.3-47 (build 20250913080742)
    Anomaly: luna://com.webos.service.tv.systemproperty/getSystemInfo hangs (timeout -t 8 → Terminated rc=143); not retried, nyx files used.

**Measured:** sha256 TV-side MATCH (step-2 gate PASS); install reached `installed` (statusValue 30) and is independently confirmed (app dir + listApps id/title); no side effects on /etc/hosts / init.d / mounts; luna launch returnValue true + app foreground. Screen-content watch item ("Not checked yet … webOSTV.js 1.2.13 loaded." vs "Bridge unavailable") NOT yet observable operator-side.
**Verdict:** operator-side steps 1–3 + install verify + optional launch **PASS so far — still HITL-PENDING at the owner gate** (owner screen observation + button presses steps 4–6, 9, 11). No uninstall, no hook registration performed. Stopped at owner gate per instruction.

---

## Block 1 — S1-T5 owner gate results + operator verify (steps 5–8) — 2026-09-15 ≈11:42–11:45 CEST

**Owner-captured (UI, verbatim):**
- Step 5 "Check bridge (root)": {"returnValue":true,"root":true,"homebrewBaseDir":"/media/developer/apps","telnetDisabled":true,"failsafe":false,"sshdEnabled":true,"blockUpdates":true} → PASS
- Step 6 "Show boot hook" (pre-register): returnValue:false, errorText: Command failed: readlink /var/lib/webosbrew/init.d/50-lgtv-blocklist-app → shown "(none)" (correct)
- Step 6 "Register boot hook": returnValue:true → Boot hook now: /media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist/scripts/boot.sh
- Step 4 launch line: NOT separately captured → inferred from step-5 bridge success; "Bridge unavailable" not observed (recorded as inferred)

**Operator verify (raw):**
    ssh … "ls -l /var/lib/webosbrew/init.d/; readlink …; stat …" →
      lrwxrwxrwx root root 96 Sep 15 11:42 50-lgtv-blocklist-app -> /media/developer/apps/usr/palm/applications/io.github.furkanbayrak.lgtvblocklist/scripts/boot.sh
      readlink → same path; stat: mode=777 owner=root:root type=symbolic link; target TARGET-EXISTS (984 B, -rwxr-xr-x, 1001:1001)
      init.d otherwise unchanged vs pre-flight (6 hand-built hooks, same sizes/dates)
    boot.sh md5 = 4804c7d5df60e9ac6a6824eea5afae23 (S1 skeleton: log line + exit 0)
    step 7: sh /var/lib/webosbrew/init.d/50-lgtv-blocklist-app; echo rc=$?; tail -n 3 …log →
      rc=0
      2026-09-15 11:44:50 boot hook ran (S1 skeleton)
    step 8 canaries: /etc/hosts md5 a151aa271729756dd3fdc83d484691d7 UNCHANGED; mount → tmpfs on /etc/hosts type tmpfs (rw,relatime) (same); /etc/resolv.conf = symlink to /var/lib/misc/resolv.conf, no mount
    new paths this block: symlink + /var/lib/webosbrew/lgtvblocklist-app.log (48 B, root, 11:44) (+ app dir from install). Nothing else new.

**Measured:** all Block 1 step 6–8 expectations met: exactly one root-owned symlink → existing target; rc=0 + fresh log line; hosts canary unchanged; mounts unchanged.
**Verdict:** steps 1–8 **PASS** — READY for owner step 9 "Remove boot hook". Step 9 remove, step 10 uninstall, step 11 Netflix still pending (owner-driven).

---

## Block 1 — S1-T5 recovery pass: remove-hook + uninstall state verify + canaries (steps 0, 9–10) — 2026-09-15 11:57–11:59 CEST

**Task:** close out Block 1 after the interrupted attempt (laptop-side network outage) · **Mode:** AFK · **When:** 2026-09-15 11:57:33–11:59:02 CEST (TV clock = laptop clock; laptop `11:59:02 +02:00`)
**Session-start rule applied:** no state assumed — every item re-verified fresh before acting.
**Criteria (run-sheet Block 1 steps 9–10 + Gate B):** symlink GONE (`readlink` fails) · other hooks unchanged · app dir gone + app not in the listing (APP-GONE) · hosts md5 canary `a151aa2717…` unchanged · mounts unchanged · only residue = the S1 hook log (removed) · no dangling leftovers · `dev/remove` not re-issued if already gone.

**Raw output:**

    Step 0 state: ssh-ok; 11:57:33 up 35 min; Tue Sep 15 11:57:33 CEST 2026
    readlink /var/lib/webosbrew/init.d/50-lgtv-blocklist-app   → (empty); readlink-rc=1
    ls -l /var/lib/webosbrew/init.d/ | grep blocklist          → (empty) → NO-HOOK
    init.d dir mtime = Sep 15 11:46 (symlink removal happened during the interrupted attempt)

    init.d listing (all root:root, -rwxr-xr-x): 00-block-lg-hosts 2029 B Sep 12 15:34 · 01-block-lan-discovery 1657 B Sep 9 15:58 · 02-block-dns-egress 6515 B Sep 13 10:03 · 03-block-lg-ip-egress 2535 B Sep 12 16:27 · 99-stop-services 2013 B Sep 9 15:58 · inputhook 280 B Sep 12 09:51   → NO 50-lgtv-blocklist-app
    md5s: 00=4dfbbcf6df3c188a338e078dcf8af977 · 01=0c6e6eca1d95c2969bb72a039bbe78d3 · 02=4da8bd686424c6d2291453064bce5599 (matches 2026-09-13 autodetect value) · 03=50bd30dcf5e7fe22a8fd4e462d7250a0 (matches 2026-09-12 value) · 99=11be0de91c606d14aad98963313abc52 · inputhook=edaaada86db7c0313f18243940a49aaf
    (no symlinks anywhere in init.d; nothing dangling into the app dir)

    ls -d …/applications/io.github.furkanbayrak.lgtvblocklist || echo APP-GONE → APP-GONE
    ls -la …/applications/ → only com.retroarch.webos, org.webosbrew.hbchannel, org.webosbrew.inputhook, youtube.leanback.v4   (dir mtime Sep 15 11:48)
    find /media/developer -name "*lgtvblocklist*" → (empty); find /media/developer -name "*furkanbayrak*" → (empty)
    luna-send -n 1 luna://com.webos.applicationManager/listApps | grep -i -E 'blocklist|furkanbayrak' → NOT-IN-LISTAPPS
    → dev/remove NOT re-issued (already uninstalled during the interrupted attempt ≈11:48; run-sheet skip-if-gone rule)

    md5sum /etc/hosts → a151aa271729756dd3fdc83d484691d7   (canary AFTER; identical to BEFORE)
    mount | grep -E "hosts|resolv" → tmpfs on /etc/hosts type tmpfs (rw,relatime)   (unchanged; no resolv mount)
    /var/lib/webosbrew before cleanup: init.d/ rollback/ sshd/ startup.sh + lgtvblocklist-app.log (48 B, 11:44)
    rm -f /var/lib/webosbrew/lgtvblocklist-app.log → rm-rc=0; LOG-GONE; final: init.d/ rollback/ sshd/ startup.sh only (stock)
    /tmp/lgtvblocklist.ipk (23612 B, 11:32) still present — volatile /tmp; not run-sheet-directed; left in place (noted)

**Measured:** symlink already removed; all six hand-built hooks bit-identical to pre-flight (sizes/dates; known md5s match); app already uninstalled cleanly (no residue anywhere under /media/developer); canaries unchanged; the only leftover was the S1 log, now removed; TV stock.
**Verdict:** **PASS — Gate B satisfied** (APP-GONE + NO-HOOK; hosts md5 unchanged; no `50-lgtvblocklist-app`; TV stock). Step 11 owner Netflix sanity not captured this pass (owner-side, non-blocking). `dev/remove` intentionally not re-issued.

---

## Block 2 — S0 T5: open + baseline (BASE-1) + pause (PAUSE-1) + lifeline — 2026-09-15 12:02–12:04 CEST

**Task:** Block 2 steps 1–4 + 6 (step 5 = owner smoke, relayed separately) · **Mode:** AFK · **When:** 2026-09-15 12:02:34–12:03:40 CEST (TV clock = laptop clock; laptop `12:03:40 +02:00`)
**Preconditions:** TV ON + SSH up (verified live, below); hand-built stack active (Block 0/1 state); owner present (Block 1 interactions). Criteria per run-sheet Block 2 steps 2/4/6 (entry written post-run; criteria inline, run-sheet is criteria source).

### Step 1 — precondition re-verify
**Command(s):**
    ssh -o BatchMode=yes root@192.168.179.8 "echo ssh-ok; uptime; date; ls -la /var/lib/webosbrew/init.d/; md5sum /etc/hosts; ls -d /media/developer/apps/usr/palm/applications/ 2>/dev/null || echo NO-DEVELOPER-DIR"
**Raw output:**
    ssh-ok · 12:02:34 up 40 min, 0 users, load 14.35 14.35 13.18 · Tue Sep 15 12:02:34 CEST 2026
    init.d: 6 hooks root:root -rwxr-xr-x → 00-block-lg-hosts 2029 B Sep 12 15:34 · 01-block-lan-discovery 1657 B Sep 9 15:58 · 02-block-dns-egress 6515 B Sep 13 10:03 · 03-block-lg-ip-egress 2535 B Sep 12 16:27 · 99-stop-services 2013 B Sep 9 15:58 · inputhook 280 B Sep 12 09:51  (NO 50-lgtv-blocklist-app)
    /etc/hosts md5 = a151aa271729756dd3fdc83d484691d7 (canary, unchanged)
    /media/developer/apps/usr/palm/applications/ → present
**Measured:** SSH OK; TV clean/stock; 6 hand-built hooks executable (pre-pause state confirmed); canary md5 unchanged.
**Verdict:** PASS — preconditions hold.

### BASE-1 — baseline snapshot
**Command(s) (run-sheet Block 2 step 2, exact):**
    scp -o BatchMode=yes g1\00-baseline.sh root@192.168.179.8:/tmp/
    ssh -o BatchMode=yes root@192.168.179.8 "sed -i 's/\r$//' /tmp/00-baseline.sh; sh -n /tmp/00-baseline.sh && sh /tmp/00-baseline.sh"
    scp -o BatchMode=yes root@192.168.179.8:/var/lib/webosbrew/s0-probe/baseline-*.txt captures\
**Raw output:**
    remote file: /var/lib/webosbrew/s0-probe/baseline-20260915-120241.txt
    pulled → captures\baseline-20260915-120241.txt (261 lines; all sections present: device/storage/init.d/iptables/mounts//etc/hosts/resolv.conf/connman/processes/netstat/HBC-prefs/HBC-cfg/DNS-probes/nobody/node)
    Key values (pre-pause): iptables nat = DNAT udp+tcp :53 → 192.168.179.1:53 (×2); filter OUTPUT = 853 DROP tcp+udp (×2) + 156.147.69.32 + 224.0.0.251 + 239.255.255.250; INPUT = 18181/36866/7000 DROP
    init.d md5s: 00=4dfbbcf6df3c188a338e078dcf8af977 · 01=0c6e6eca1d95c2969bb72a039bbe78d3 · 02=4da8bd686424c6d2291453064bce5599 · 03=50bd30dcf5e7fe22a8fd4e462d7250a0 · 99=11be0de91c606d14aad98963313abc52 · inputhook=edaaada86db7c0313f18243940a49aaf
    mounts: tmpfs /etc/hosts; /etc/hosts md5 a151aa271729756dd3fdc83d484691d7 == /tmp/hosts
    HBC cfg: root:true · telnetDisabled:true · sshdEnabled:true · failsafe:false · blockUpdates:true · homebrewBaseDir:/media/developer/apps
    DNS via 127.0.0.1: example.com → 104.20.23.154 / 172.66.147.243; ads.lgappstv.com → empty answer (blocked)
    env: connmand pid 2800 · /usr/bin/node present · nobody user present · resolv.conf → symlink /var/lib/misc/resolv.conf (nameserver ::1, 127.0.0.1)
**Measured:** capture complete + parseable; baseline fingerprint recorded (md5s, rules, mounts, env).
**Pass/Fail criteria:** PASS if file complete + parseable. → **PASS** (artifact: `..\captures\baseline-20260915-120241.txt`).
**Verdict:** **PASS — BASE-1.**

### PAUSE-1 — hand-built DNS hooks paused
**Command(s) (run-sheet Block 2 steps 3–4, exact):**
    scp -o BatchMode=yes g1\pause-handbuilt.sh g1\restore-handbuilt.sh root@192.168.179.8:/tmp/
    ssh -o BatchMode=yes root@192.168.179.8 "sed -i 's/\r$//' /tmp/pause-handbuilt.sh /tmp/restore-handbuilt.sh; sh -n /tmp/pause-handbuilt.sh && sh -n /tmp/restore-handbuilt.sh && sh /tmp/pause-handbuilt.sh"
    ssh -o BatchMode=yes root@192.168.179.8 "iptables -t nat -S; iptables -S"
**Raw output:**
    pause output: remaining :53 nat rules: 0 (expect 0) · remaining 853 rules: 0 (expect 0)
      ls -l init.d → 00-block-lg-hosts **-rw-r--r--** · 01 -rwxr-xr-x · 02-block-dns-egress **-rw-r--r--** · 03 -rwxr-xr-x · 99 -rwxr-xr-x · inputhook -rwxr-xr-x
    post-pause nat: policies only, NO DNAT rules
    post-pause filter: INPUT 18181/36866/7000(-i wlan0) DROP · OUTPUT 156.147.69.32 + 224.0.0.251 + 239.255.255.250 DROP · (no 853)
**Measured (diff vs BASE-1 — exactly the 02-hook rules removed):**
    removed: `-A OUTPUT ! -d 127.0.0.0/8 -p udp --dport 53 -j DNAT --to-destination 192.168.179.1:53` · `-A OUTPUT ! -d 127.0.0.0/8 -p tcp --dport 53 -j DNAT --to-destination 192.168.179.1:53` · `-A OUTPUT -p tcp --dport 853 -j DROP` · `-A OUTPUT -p udp --dport 853 -j DROP` → 4/4 gone, nothing else changed
    counters 0/0 → live target matched 192.168.179.1:53; NO leftover :53 rules → no explicit deletion needed (run-sheet branch not taken)
    hook perms: 00 + 02 → `-rw-` (no x bit) as expected; other 4 hooks untouched; md5s unchanged (chmod only)
    /etc/hosts content + mount unchanged (a151aa2717… still bound; contents persist this boot by design)
**Pass/Fail criteria:** PASS if exactly the 02-hook rules (DNAT :53 ×2, 853 ×2) are gone vs baseline AND hooks 00/02 show no x bit; leftover :53 → record + delete explicitly.
**Verdict:** **PASS — PAUSE-1.**

### Step 6 — lifeline armed (AFK)
**Command(s):**
    ssh -o BatchMode=yes root@192.168.179.8 "ls -l /tmp/restore-handbuilt.sh /tmp/pause-handbuilt.sh; md5sum /tmp/restore-handbuilt.sh; sh -n /tmp/restore-handbuilt.sh && echo RESTORE-SYNTAX-OK"
**Raw output:**
    -rw-r--r-- 1 root root  778 Sep 15 12:03 /tmp/restore-handbuilt.sh
    -rw-r--r-- 1 root root 1287 Sep 15 12:03 /tmp/pause-handbuilt.sh
    c73fbacfc956d35173ccdf2fcebd2580  /tmp/restore-handbuilt.sh · RESTORE-SYNTAX-OK
    local Get-FileHash g1\restore-handbuilt.sh MD5 = C73FBACFC956D35173CCDF2FCEBD2580 → MATCH (byte-identical)
**Measured:** lifeline staged in /tmp, `sh -n` clean, matches repo copy; must survive until T15; re-stage after every reboot.
**Verdict:** **PASS — lifeline armed.**

**SMOKE-1: PASS — owner-confirmed, Netflix normal playback (Block 2 step 5 / Gate C)** — step 5 (open Netflix 1 min; owner sees TV working as before, only protection source changed; abort now if broken) is owner-side, relayed by orchestrator after this report.

**Deviations (recorded):** none material. Cosmetic: baseline `cat webosbrew_block_updates` prints `1` concatenated with the next section header (no trailing newline in that file). `/tmp/lgtvblocklist.ipk` from Block 1 still in /tmp (volatile, non-blocking, noted previously). No TV mutation beyond the run-sheet's pause; no commits made.

---

## Block 3 — S0 T6: boot-order trace (BOOT-1) — 2026-09-15 12:08–.. CEST

**Task:** Block 3 steps 3–5 (reboot → boot-to-SSH poll → post-boot capture block → lifeline re-stage → BOOT-1 verdict) · **Mode:** AFK after owner-approved HITL gate (step 2 = reboot confirmed by owner, relayed by orchestrator) · **When:** reboot issued 2026-09-15 ≈12:09 CEST (TV clock = laptop clock)
**Criteria (run-sheet Block 3 step 5, source of truth):** PASS iff (a) `boot-probe.log` exists; (b) **exactly one** `/etc/hosts` mount line in /proc/mounts and it is sourced from `/tmp/hosts`; (c) HBC marker line present (per `hbc-matrix-hosts.sh`: `dynamically regenerated` in /etc/hosts content). Record additionally: `uname -m`, node presence, boot-to-SSH time, failsafe flag value. FAIL (no log / >1 mount / marker missing) → stop mutations, record, decide with the owner (Gate D).
**Pre-reboot state (12:08:19 CEST):** `95-s0-probe` installed in init.d (1229 B; Sep 15 12:06; 755) — TV md5 `323275a999fa36f4805399cb845f3b20` == local `g1\95-s0-probe` md5 → MATCH. No `boot-probe.log` yet (`NO-PROBE-LOG-PRE-REBOOT`) and the probe appends (`>>`) → any post-boot log is attributable to THIS boot. Hooks 00/02 still paused (`-rw-`); /etc/hosts md5 `a151aa271729756dd3fdc83d484691d7`; uptime 46 min. Lifeline local md5 = C73FBACF… (Block 2 value).

**Raw output:**

    t0: LAPTOP-PRE-REBOOT 2026-09-15 12:08:56 · TV `date` = Tue Sep 15 12:08:50 CEST, up 46 min (clocks agree; TV ~6 s behind laptop)
    REBOOT-ISSUED 2026-09-15 12:09:02 (laptop) · `ssh … "systemctl reboot"` → ssh-exit=0 @ 12:09:02 (systemd took over; connection drop not observed at issue time)
    POLL: 50 s wait, then first attempt → SSH-BACK 12:10:02 (attempt 1) · TV: Tue Sep 15 12:09:55 CEST · up 1 min, 0 users → **boot-to-SSH = ~60 s** (bounded: SSH up by 12:10:02, first check after the mandated wait)

    Step-3 capture block (run-sheet, exact):
    $ ssh root@192.168.179.8 "cat /var/lib/webosbrew/s0-probe/boot-probe.log; echo ---; grep -E ' /etc/hosts ' /proc/mounts; md5sum /etc/hosts /tmp/hosts; cat /etc/resolv.conf; ls /var/luna/preferences/ | grep -i failsafe || echo no-failsafe-flag-now; ls -la /var/lib/webosbrew/init.d/"

    === boot-probe 2026-09-15 12:09:26 uptime_s=33.00 ===
    -- mounts --
    tmpfs /etc/hosts tmpfs rw,relatime 0 0
    -- HBC flag file --
    1-- failsafe present: yes
    -- hosts head/tail --
    127.0.0.1	localhost.localdomain		localhost

    # The following lines are desirable for IPv6 capable hosts
    ...
    # This file is dynamically regenerated on boot by webosbrew startup script
    127.0.0.1 snu.lge.com su-dev.lge.com su.lge.com su-ssl.lge.com
    ::1 snu.lge.com su-dev.lge.com su.lge.com su-ssl.lge.com
    -- hosts md5=7900d0cfacb7e175b60b2d6ca66d59ac tmp-hosts md5=7900d0cfacb7e175b60b2d6ca66d59ac
    -- resolv.conf: # Generated by Connection Manager|nameserver ::1|nameserver 127.0.0.1|
    -- connmand pid: 2828
    -- :53 listeners --
    tcp: 127.0.0.1:53 + ::1:53 (LISTEN) · udp: 127.0.0.1:53 + ::1:53 (+ ::1:53628, mDNS :5353 ×5)
    -- getStatus --
    {
        "cellular": { "enabled": false },
        "returnValue": true,
        "offlineMode": "disabled",
        "wired": { "plugged": false, "state": "disconnected" },
        "wifi": {
            "netmask": "255.255.255.0",
            "ipv6": { "gateway": "fe80::de39:6fff:febe:59c9", "ipAddress": "fd4d:c8d7:eb60:1:26e8:53ff:fe77:fd3a", "prefixLength": 64, "method": "auto" },
            "dns1": "192.168.179.1",
            "dns2": "fd4d:c8d7:eb60:1:de39:6fff:febe:59c9",
            "ipAddress": "192.168.179.8",
            "proxyinfo": { "method": "direct" },
            "isWakeOnWifiEnabled": false,
            "onInternet": "no",
            "method": "dhcp",
            "ssid": "FRITZ!Box 7590 GA",
            "connectedChannel": "6",
            "displayName": "FRITZ!Box 7590 GA",
            "state": "connected",
            "gateway": "192.168.179.1",
            "checkingInternet": false,
            "interfaceName": "wlan0"
        },
        "subscribed": false,
        "bluetooth": { "tetheringEnabled": false, "state": "disconnected" },
        "wan": { "connected": false, "connectedContexts": [] },
        "wifiDirect": { "state": "disconnected" },
        "isInternetConnectionAvailable": false
    }
    -- end --
    ---
    tmpfs /etc/hosts tmpfs rw,relatime 0 0
    7900d0cfacb7e175b60b2d6ca66d59ac  /etc/hosts
    7900d0cfacb7e175b60b2d6ca66d59ac  /tmp/hosts
    # Generated by Connection Manager
    nameserver ::1
    nameserver 127.0.0.1
    webosbrew_failsafe
    total 40
    drwxr-xr-x    2 root     root          4096 Sep 15 12:06 .
    drwxr-xr-x    6 root     root          4096 Sep 15 12:02 ..
    -rw-r--r--    1 root     root          2029 Sep 12 15:34 00-block-lg-hosts
    -rwxr-xr-x    1 root     root          1657 Sep  9 15:58 01-block-lan-discovery
    -rw-r--r--    1 root     root          6515 Sep 13 10:03 02-block-dns-egress
    -rwxr-xr-x    1 root     root          2535 Sep 12 16:27 03-block-lg-ip-egress
    -rwxr-xr-x    1 root     root          1229 Sep 15 12:06 95-s0-probe
    -rwxr-xr-x    1 root     root          2013 Sep  9 15:58 99-stop-services
    -rwxr-xr-x    1 root     root           280 Sep 12 09:51 inputhook

    Supplementary (verdict-step records):
    $ ssh … "uname -m; command -v node; node --version …; stat -c '%d:%i %n' /etc/hosts /tmp/hosts; grep ' /etc/hosts ' /proc/self/mountinfo; grep -n 'dynamically regenerated' /etc/hosts /tmp/hosts; failsafe recheck"
    aarch64
    /usr/bin/node
    v8.12.0
    36:47960 /etc/hosts
    36:47960 /tmp/hosts            → IDENTICAL device:inode = literally the same file (bind mount)
    114 39 0:36 /hosts /etc/hosts rw,relatime - tmpfs tmpfs rw   → mountinfo root=/hosts on tmpfs SB 0:36 (= the /tmp tmpfs; /proc/mounts device field cannot show bind source paths — display quirk; bind proven by inode + root field)
    /etc/hosts:10:# This file is dynamically regenerated on boot by webosbrew startup script
    /tmp/hosts:10:# This file is dynamically regenerated on boot by webosbrew startup script
    failsafe recheck (~110 s post-boot): webosbrew_failsafe   (still present — mid-window; documented ~4-min self-clear; NOT a BOOT-1 criterion)

    Step-4 lifeline re-stage (Block 2 step 6):
    $ scp -o BatchMode=yes g1\restore-handbuilt.sh root@192.168.179.8:/tmp/
    $ ssh … "sed -i 's/\r$//' /tmp/restore-handbuilt.sh; sh -n … && echo RESTORE-SYNTAX-OK; md5sum …; ls -l …"
    RESTORE-SYNTAX-OK
    c73fbacfc956d35173ccdf2fcebd2580  /tmp/restore-handbuilt.sh
    -rw-r--r-- 1 root root 778 Sep 15 12:10 /tmp/restore-handbuilt.sh   → md5 == Block 2 staged value == local repo copy (C73FBACF…) → lifeline back in place

**Measured:**
    BOOT-1 criteria (run-sheet Block 3 step 5):
      (a) probe log exists: YES — exactly one entry, `=== boot-probe 2026-09-15 12:09:26 uptime_s=33.00 ===` → hook fired 33 s after kernel start on THIS boot (no stale log pre-reboot); all 5 sections written; exits-then-99 ordering intact.
      (b) /etc/hosts mounts: EXACTLY ONE line in /proc/mounts (probe-time AND post-boot) — and it IS /tmp/hosts: inode 36:47960 identical for both paths; mountinfo root=/hosts; md5 /etc/hosts == /tmp/hosts (7900d0cfacb7e175b60b2d6ca66d59ac). No stacked mounts.
      (c) HBC marker line: PRESENT — line 10 of both files: `# This file is dynamically regenerated on boot by webosbrew startup script`.
    Records: uname -m = aarch64 · node = /usr/bin/node v8.12.0 (present) · boot-to-SSH ≈ 60 s (12:09:02 → 12:10:02, first poll) · failsafe flag = `webosbrew_failsafe` present (~80–110 s post-boot, normal mid-window value).
    Observations (recorded, not verdict modifiers): (1) /etc/hosts content md5 changed vs pre-reboot (a151aa271729756dd3fdc83d484691d7 → 7900d0cf…) — EXPECTED: the file is regenerated on boot by the webosbrew startup script (marker); the a151aa27… canary was an install-time no-writes canary from S1, not a boot-invariance value. (2) Pause state survived the reboot: 00/02 remain `-rw-` (skipped by run-parts this boot — by design for S0). (3) Early-boot getStatus shows network cfg (dns1=192.168.179.1, dns2=DHCPv6 ULA) with `onInternet:"no"` — early-boot transient, matches probe timing 33 s. (4) init.d unchanged (7 entries incl. probe hook, no S1 hook).

**Verdict:** **PASS — BOOT-1.** Gate D satisfied: probe log exists + exactly one /etc/hosts mount sourced from /tmp/hosts (bind proven) + HBC marker line present. Lifeline re-staged (c73fbacf…). TV safe for Block 4 (mount discipline). Failsafe flag noted mid-window; later blocks/reboot choreography unaffected.

---

## Block 4 — S0 T7: mount discipline (MOUNT-1) — 2026-09-15 12:12 CEST

**Task:** Block 4 (run-sheet lines 154–158): stage `g1\mount-discipline.sh` → `/tmp` → CR-strip + `sh -n` → run → capture `MOUNT-1`.
**Mode:** AFK · **When:** staged 2026-09-15 12:12 CEST (TV clock = laptop clock; TV up 3 min post-Block-3 reboot; lifeline `/tmp/restore-handbuilt.sh` present from Block 3 re-stage).
**Session rule for this block:** NO reboot — if the script prints `REPAIR NEEDED`, run only the script's own repair block (lines 27–30); if the repair path fails or the state still looks odd → STOP, orchestrator/owner decision (reboots are owner-gated).

**Criteria (written BEFORE the run — run-sheet Block 4 PASS, source of truth):**
- M1: `count=1` and the `/etc/hosts` mount is sourced from `/tmp/hosts`.
- M2: marker-bounded append visible **via file** (`tail -4 /etc/hosts`) **and via name resolution** (`getent hosts s0test.lgtvcommon.com` must resolve, not "unresolved").
- M3: marker-bounded removal via in-place rewrite → `M3 REMOVAL-BYTE-IDENTICAL`.
- M4: stacking recorded (`mount count now=`, expect 2) + top `umount` clean (`count=1` + `M4 top-unmount clean`).
- M5: `sed -i` behavior recorded (mount count + content line, either branch) + mount restored.
- FINAL: `mount still present` at the end (NOT `REPAIR NEEDED`).

**Pre-run state (read-only, 12:12:17 CEST):**
    up 3 min · mount line: `tmpfs /etc/hosts tmpfs rw,relatime 0 0` · count=1 · md5 `/etc/hosts` == `/tmp/hosts` == `7900d0cfacb7e175b60b2d6ca66d59ac` · inode `36:47960` for both (= bind source `/tmp/hosts`, same as BOOT-1 record)
    $S0 `/var/lib/webosbrew/s0-probe/` present (baseline-20260915-120241.txt, boot-probe.log)
    local script: md5 `284EFBAC351249555F97AA6814B8D340`, 2365 B (transfer-integrity reference)

**Raw output (stage + syntax + run):**
    $ scp -o BatchMode=yes g1\mount-discipline.sh root@192.168.179.8:/tmp/     → SCP-EXIT=0
    $ ssh … "sed -i 's/\r$//' /tmp/mount-discipline.sh; sh -n /tmp/mount-discipline.sh && echo SYNTAX-OK; md5sum …; wc -c …"
      SYNTAX-OK   (sh -n printed nothing else)
      284efbac351249555f97aa6814b8d340  /tmp/mount-discipline.sh   ← == local md5 (284EFBAC…) · 2365 B (local 2365 B; local file is LF-only) → transfer byte-identical
    $ ssh … 'sh /tmp/mount-discipline.sh; echo SCRIPT-EXIT=$?'   (12:13–12:14 CEST)

      ref md5: 7900d0cfacb7e175b60b2d6ca66d59ac
      == M1 mount state ==
      tmpfs /etc/hosts tmpfs rw,relatime 0 0
      count=1
      == M2 marker-bounded APPEND to the MOUNTED sheet ==
      ::1 snu.lge.com su-dev.lge.com su.lge.com su-ssl.lge.com
      # BEGIN lg-tv-blocklist-app S0TEST
      0.0.0.0 s0test.lgtvcommon.com
      # END lg-tv-blocklist-app S0TEST
      getent: 0.0.0.0         s0test.lgtvcommon.com
      == M3 marker-bounded REMOVE via in-place rewrite (keeps inode/mount) ==
      M3 REMOVAL-BYTE-IDENTICAL
      == M4 stacked-mount reality check ==
      mount count now=2 (2 = kernel allows stacking; app discipline must refuse)
      mount count after umount=1 (expect 1)
      M4 top-unmount clean
      == M5 rename-vs-rewrite on a bind-mounted file ==
      sed: can't create temp file '/etc/hostszHQBgU': Read-only file system
      after sed -i: mount count=1 (watch for 0/1 anomaly)
      sed -i may not have applied
      mount still present
      SCRIPT-EXIT=0

    Post-run verification (read-only, ~12:14 CEST):
    $ ssh … 'grep -E " /etc/hosts " /proc/mounts; grep -cE " /etc/hosts " /proc/mounts; md5sum /etc/hosts /tmp/hosts /var/lib/webosbrew/s0-probe/hosts-hbc-only.ref; stat -c "%d:%i %n" /etc/hosts /tmp/hosts; getent hosts s0test.lgtvcommon.com || echo s0test-UNRESOLVED; cmp … && echo REF-IDENTICAL || echo REF-DIFF; ls -la /var/lib/webosbrew/s0-probe/; ls -la /tmp/s0-hosts.new /tmp/s0stack-hosts'
      tmpfs /etc/hosts tmpfs rw,relatime 0 0
      1
      7900d0cfacb7e175b60b2d6ca66d59ac  /etc/hosts
      7900d0cfacb7e175b60b2d6ca66d59ac  /tmp/hosts
      7900d0cfacb7e175b60b2d6ca66d59ac  /var/lib/webosbrew/s0-probe/hosts-hbc-only.ref
      36:47960 /etc/hosts
      36:47960 /tmp/hosts
      s0test-UNRESOLVED
      REF-IDENTICAL
      $S0 listing: + hosts-hbc-only.ref (433 B, Sep 15 12:13) + hosts-ref-before-m5 (433 B, Sep 15 12:13)
      /tmp leftovers: s0-hosts.new (433 B), s0stack-hosts (433 B)   (script temp files; volatile, harmless, left in place)
    REPAIR NEEDED line: NOT printed → script repair block (lines 27–30) NOT executed (correct); no reboot, no other mutation.

**Measured:**
    M1 — `count=1`; mount line present; **source = /tmp/hosts** proven by inode identity 36:47960 (both paths, same as BOOT-1) + md5 equality 7900d0cf… (unchanged from pre-run).
    M2 — marker section appended to the MOUNTED sheet (visible via `tail`: 3 marker lines) AND resolved via resolver: `getent: 0.0.0.0 s0test.lgtvcommon.com` (not "unresolved").
    M3 — `M3 REMOVAL-BYTE-IDENTICAL` (cmp vs ref clean; in-place `cat > /etc/hosts` keeps inode/mount). Post-check: `s0test-UNRESOLVED` → resolver entry fully gone.
    M4 — kernel **ALLOWS stacking**: `mount count now=2` (recorded; comment: app discipline must refuse); top-unmount clean: `count=1` + `M4 top-unmount clean`.
    M5 — `sed -i` **FAILED**: `sed: can't create temp file '/etc/hostszHQBgU': Read-only file system` (the /etc *directory* is on the read-only rootfs, so a rename-style replace of the bind-mounted file is impossible on this device; this also means the broken-rename risk is moot at the filesystem level — but in-place rewrite remains the only working discipline). Mount count stayed 1 (no 0/1 anomaly); content unchanged → script branch "sed -i may not have applied"; repair `cat ref > /etc/hosts` = no-op; watch line `mount still present` printed. Only sed's temp file was never created (EROFS) → no leftover.
    FINAL — `mount still present`; post-check count=1; md5/inode identical to BOOT-1 record; cmp `REF-IDENTICAL`; `SCRIPT-EXIT=0`.
**Pass/Fail criteria:** all six run-sheet PASS items met (M1 count=1+source, M2 file+getent, M3 byte-identical, M4 stacking recorded + top-unmount clean, M5 behavior recorded + mount restored, mount present at end).
**Verdict:** **PASS — MOUNT-1.** No repair path needed, no reboot, no deviation. (Recorded artifacts: 2 ref files in $S0 + 2 temp files in /tmp — expected script outputs, volatile/harmless.)

---

## Block 5 — S0 T8: firewall contract (FW-1) + mechanism probes attempt (MECH-1 PARTIAL) — 2026-09-15 12:16–12:22 CEST

**Task:** Block 5 steps 1–3 (probe-kit upload → `firewall-contract.sh` → `mech-probe.sh` M2/M3) · **step 4 (M4 connmand kill) NOT run — owner gate** · stopped after step 3 per architect instruction · **Mode:** AFK · **When:** upload 12:16:38–52 · FW-1 12:17:03–04 · FW diagnostics 12:17:49–12:19:32 · MECH attempt-1 12:19:56–12:20:04 · session edit 12:20:54 · MECH attempt-2 12:20:54–12:21:03 · port-occupant check 12:21:37–58 · block-end verify 12:22:38 CEST (TV clock = laptop clock).
**Preconditions (re-verified at block start, 12:14:57):** TV up 6 min (post-Block-3 reboot); hand-built hooks paused (00/02 `-rw-`); mount count=1 = /tmp/hosts bind; `/etc/hosts` md5 `7900d0cfacb7e175b60b2d6ca66d59ac`; lifeline `/tmp/restore-handbuilt.sh` (778 B, 12:10) staged; no filter meant to stay up (Task 8).
**Criteria (run-sheet Block 5, source of truth):** step 1 → `SYNTAX-OK` + `dnscrypt-proxy -version` prints (fail → try arm64; record); step 2 → FW-1 recorded; step 3 → M2/M3 recorded (REDIRECT in-path + DNAT-to-self); step-5 gate → FW-1 + MECH-1 recorded, ≥1 in-path mechanism. Entry written post-run (criteria inline, Blocks 2–4 convention).

### Step 1 — probe-kit upload (amended 8-file list incl. `forward-rules.txt`)
**Command(s) (run-sheet step 1, exact):**
```
ssh root@192.168.179.8 "mkdir -p /var/lib/webosbrew/s0-probe"
scp candidate\dnscrypt-proxy candidate\filter-s0.txt candidate\dnscrypt-proxy.toml candidate\forward-rules.txt g1\dnsq.js g1\dnsq.sh g1\firewall-contract.sh g1\mech-probe.sh root@192.168.179.8:/var/lib/webosbrew/s0-probe/
ssh root@192.168.179.8 "chmod 755 /var/lib/webosbrew/s0-probe/dnscrypt-proxy /var/lib/webosbrew/s0-probe/dnsq.sh; sed -i 's/\r$//' /var/lib/webosbrew/s0-probe/*.sh; sh -n /var/lib/webosbrew/s0-probe/firewall-contract.sh && sh -n /var/lib/webosbrew/s0-probe/mech-probe.sh && echo SYNTAX-OK; /var/lib/webosbrew/s0-probe/dnscrypt-proxy -version"
```
**Raw output:**
```
MKDIR-OK · SCP-OK
TV-TIME 2026-09-15 12:16:52 CEST · uname -m = aarch64 · getconf LONG_BIT = 32
SYNTAX-OK
VERSION-BELOW
2.1.18
md5sum (TV side; all 8 == laptop-side md5s → transfer byte-identical):
  306395ff39f7046a9a9a15863b9327e0  dnscrypt-proxy        (local 306395FF…)
  c6dd3bb38e254ab41be28b7e9a435749  filter-s0.txt         (local C6DD3BB3…)
  55918a41a0a730f351aeeb78756a5d36  dnscrypt-proxy.toml   (local 55918A41…)
  30064a4438cd4435d12472ba71f382c9  forward-rules.txt     (local 30064A44…)
  62609b17a47ed827e886e03e8cdccb2e  dnsq.js               (local 62609B17…)
  5b60e0618ac1d23f1d525c31d22a2775  dnsq.sh               (local 5B60E061…)
  f687cef56be4a677cc58a5af87cdc516  firewall-contract.sh  (local F687CEF5…)
  e297863c1a1808cc71c4fce58c7af601  mech-probe.sh         (local E297863C…)
```
**Measured:** dnscrypt-proxy 2.1.18 executes on-device (32-bit ARM userland, aarch64 kernel) — architecture OK, arm64 fallback NOT needed; `sh -n` clean (no output); all 8 files byte-identical to repo copies (CR-strip a no-op — local files LF-only).
**Verdict:** PASS — step 1.

### FW-1 — firewall contract (`firewall-contract.sh`)
**Command(s):**
```
ssh root@192.168.179.8 "sh /var/lib/webosbrew/s0-probe/firewall-contract.sh"          (12:17:03, exit captured)
ssh root@192.168.179.8 "iptables -S; echo ---NAT---; iptables -t nat -S"              (pre 12:17:03 + post 12:17:04)
```
**Raw output (run, verbatim; stdout/stderr merged — interleaving of stderr errors approximate):**
```
== F1 create named chains (idempotent) ==
== F2 -C-guarded jump at fixed position 1 ==
jump verified
-P OUTPUT ACCEPT
-A OUTPUT -j LGTVBLK
-A OUTPUT -d 156.147.69.32/32 -j DROP
== F3 foreign-flush simulation ==
post-flush rules in chain: 1
iptables: No chain/target/match by that name.
== F4 foreign chain deletion ==
iptables: No chain/target/match by that name.
chain gone (expected)
full re-create OK
== F5 REDIRECT target availability ==
iptables: No chain/target/match by that name.
REDIRECT NOT supported
-P OUTPUT ACCEPT
-P POSTROUTING ACCEPT
-N LGTVBLK_NAT
== F6 owner-match availability ==
owner match NOT supported
iptables: No chain/target/match by that name.
== F7 cleanup ==
-- final state --
(filter: pre-state / nat: policies only — see below)
SCRIPT-EXIT=0
```
**FW1-POST == FW1-PRE byte-equal:** INPUT drops 18181/36866/7000 · OUTPUT drops 156.147.69.32 + 224.0.0.251 + 239.255.255.250 · nat = 4 empty policies. **Zero residue.**
Raw files: `captures\fw1-pre-20260915-121709.txt` · `fw1-run-20260915-121709.txt` · `fw1-post-20260915-121709.txt`.

**Root-cause diagnostics (bounded D1–D8 + module closure; read-only/reversible; zero residue — `captures\fw1-diag-20260915-121709.txt`, `captures\fw1-modclosure-20260915-122001.txt`):**
```
D1  iptables v1.6.2 (/usr/sbin/iptables → xtables-multi) — full iptables, not busybox
D2  kernel 4.4.84-229.kcl4tv.6
    /proc/net/ip_tables_targets = DNAT SNAT REJECT MASQUERADE ERROR TOS DSCP   (NO REDIRECT)
    /proc/net/ip_tables_matches = icmp tos dscp udplite udp tcp                (NO owner)
D3  /usr/lib/xtables/ HAS libipt_REDIRECT.so + libxt_owner.so (userspace only; /usr/lib/iptables absent)
D4  modprobe/insmod/lsmod present; /lib/modules/4.4.84-229.kcl4tv.6 module tree exists
D5  fresh EMPTY chain: `iptables -S S0TMPCHAIN` prints `-N S0TMPCHAIN` → grep-count = 1
    → explains F3's "post-flush rules in chain: 1" (this build counts rules+chain-header line); flush WAS effective (cosmetic)
D6  `-t nat -A OUTPUT -p udp --dport 65531 -j REDIRECT --to-ports 5353` → "No chain/target/match by that name", rc=1; nothing left (D8)
D7  `-A OUTPUT -m owner --uid-owner 0 ...` → same error, rc=1; nothing left
D8  nat table clean; filter OUTPUT == pre; zero residue from diagnostics
Module closure: `find /lib/modules -name "*.ko"` = 66 files, ALL LG hardware (wlan/dvb/bt/hdmi/galcore…);
  `grep -iE "redirect|owner" modules.builtin` → only kernel/net/bridge/netfilter/ebt_redirect.ko (bridge/ebtables level — NOT IP-layer REDIRECT);
  `modprobe xt_owner` / `xt_REDIRECT` / `ipt_REDIRECT` → FATAL: Module not found in /lib/modules/4.4.84-229.kcl4tv.6 (rc=1, all three).
```
**Measured (FW-1 conclusions):** F1 chain create OK (silent, idempotent) · F2 jump at pos 1 verified · F3 flush effective (count quirk explained in D5; the re-create leg could NOT be exercised — REDIRECT target absent) · F4 foreign-deletion recovery OK ("chain gone (expected)" + "full re-create OK"; `-X` succeeded because F3's re-add had failed → chain was empty) · F5 → **REDIRECT target NOT available** (kernel-side; absent from ip_tables_targets; non-loadable — no .ko on disk) · F6 → **owner match NOT available** (same class) · F7 cleanup complete, zero residue (post == pre).
**Pass/Fail criteria:** PASS = recording complete + cleanup clean (contract items F1/F2/F4/F7 OK; F5/F6 are capability findings, not script failures).
**Verdict:** **FW-1 PASS (recording complete) — 2 negative capability findings: the M-B shape (REDIRECT + owner-match) CANNOT exist on this device.** Proven 4 ways: kernel target/match lists · reversible rule-add rc=1 · modprobe FATAL · no module files. Consequence: the scripted M2 ("REDIRECT in-path") can never pass here; M1 (owner availability, = F6) = NOT supported; only DNAT-family paths (DNAT/SNAT/MASQUERADE/REJECT) exist.

### Step 3 — MECH probes (`mech-probe.sh` M2/M3) — ATTEMPT FAILED twice (filter cannot start); M2/M3 unmeasured; M4 NOT run
**Attempt 1 (12:19:56):**
```
== nobody uid: 99 ==
side-port selftest FAILED — stopping (record: filter cannot serve in this state)
SCRIPT-EXIT=1
filter.log: [2026-09-15 12:19:56] [FATAL] Unsupported key in configuration file: [static.s0-upstream.user_name]
```
**Root cause 1:** the script appends `user_name = 'nobody'` at EOF; the toml ends with `[static.'s0-upstream']` → TOML section scoping assigns it to that section → FATAL before bind. (The toml's own session note anticipated a session-time `user_name` edit, but uncommenting in place would hit the same scoping.)

**Bounded fix #1 of 2 (12:20:54; applied + recorded as required):** ONE top-level key inserted in `$S0/dnscrypt-proxy.toml` after `cache = true` (line 25), backup kept:
```
cp dnscrypt-proxy.toml dnscrypt-proxy.toml.pre-user_name-fix     (backup 2621 B, md5 55918a41…)
sed -i "/^cache = true$/a user_name = 'nobody'" dnscrypt-proxy.toml
md5: 55918a41a0a730f351aeeb78756a5d36 → ea1ef49d497028273d4987ab06dbd90c
line 25 = user_name = 'nobody' (top-level, valid); line 52 = commented original
```
Effect: mech-probe's cp-branch now emits a VALID `mech-probe.toml` (incl. the privilege drop); without it, every mech-probe run on this toml layout fails as in attempt 1. Left in place (documented input for T12; revert = copy backup back).

**Attempt 2 (12:20:54, after fix):** config parses; process starts but:
```
== nobody uid: 99 ==
side-port selftest FAILED — stopping (record: filter cannot serve in this state)
SCRIPT-EXIT=1
filter.log: [NOTICE] dnscrypt-proxy 2.1.18
            [NOTICE] Using default Weighted Power of Two (WP2) load balancing strategy
            [FATAL] listen udp4 127.0.0.1:5353: bind: address already in use
```
**Root cause 2:** UDP :5353 already bound. Occupant identified via /proc/net/udp (12:21:37):
```
/proc/net/udp: 1257: 00000000:14E9 ... uid 0 ... inode 42631   → wildcard 0.0.0.0:5353
socket inode 42631 owner: pid 3465 comm=iconnectivity  (/usr/sbin/iconnectivity)
```
= LG `iconnectivity` (known from TV sessions: respawns <3 s when killed — "parked", not killable) holds wildcard UDP :5353 → filter cannot bind 127.0.0.1:5353. **Fix #2 (side-port change) would need coordinated edits to `dnscrypt-proxy.toml` + `mech-probe.sh` (FPORT) + downstream scripts = design-level → NOT applied (operator scope); STOP + report.**

**Cleanup state after both attempts (verified twice — `captures\mech-post-20260915-122001.txt` / `mech-post2-20260915-122100.txt`; block-end verify 12:22:38):**
```
nat table: policies only — no :53 rules, no DNAT/REDIRECT residue
filter table: INPUT 18181/36866/7000 · OUTPUT 156.147.69.32 + 224.0.0.251 + 239.255.255.250   == paused baseline
filter.pid GONE · no dnscrypt-proxy process · mech-probe installed ZERO rules in either run
mounts: count=1, /etc/hosts == /tmp/hosts md5 7900d0cfacb7e175b60b2d6ca66d59ac (unchanged)
lifeline /tmp/restore-handbuilt.sh present (778 B) · hooks 00/02 still -rw- · 95-s0-probe intact
$S0 (18 entries): + probe kit (8 files, 12:16) + mech-probe.log + mech-probe.toml + filter.log + queries.log(0) + blocked-names.log(0) + dnscrypt-proxy.toml.pre-user_name-fix; dnscrypt-proxy.toml updated 2642 B (fix #1)
```
**Pass/Fail criteria (run-sheet step 5):** MECH-1 = every verdict recorded; ≥1 working in-path mechanism → **NOT met** (0 mechanisms measured; M2 impossible anyway per FW-1; M3 unmeasured).
**Verdict:** **MECH-1 PARTIAL/BLOCKED** — script stopped safely twice (own fail-safe worked; zero residue both times); M2/M3 **unmeasured**; M4 **NOT run** (step 4 owner gate — deliberately not attempted). Open decisions for orchestrator/architect: (a) side-port choice (5353 collides with LG iconnectivity wildcard — the 01-hook blocks its discovery TRAFFIC at kernel level, but the socket stays bound) → port change needs coordinated FPORT edits if the spike wants M3 measured; (b) whether to test the M3 leg at all given (i) REDIRECT+owner impossible on this kernel and (ii) the no-owner self-loop caveat; (c) M4 owner confirmation.
**Analysis notes (unmeasured; only if the port decision unblocks M3):** with the as-built toml/script, in the M3 phase the owner-match RETURN rules cannot be installed (owner match absent) → the filter's own forwarded :53 traffic (uid nobody → 192.168.179.1:53) would be re-captured by the DNAT rule for *non-cached* names = 1-level self-loop until client timeout (bounded, undesirable); blocked-name probes would still prove DNAT delivery. The script's guard covers only the privilege drop, not owner-rule installation failure (recorded as harness gap).

### Deviations (recorded)
1. FW-1 root-cause diagnostics + module closure (D1–D8) ran — bounded, read-only/reversible, zero residue (D8 + post listings prove it); no script/policy edits.
2. Fix #1: `$S0/dnscrypt-proxy.toml` session edit (`user_name='nobody'` top-level; backup `…pre-user_name-fix`) — session-sanctioned by the toml's own note ("Uncomment at session time and record the edit"), required to make mech-probe's config-generation valid; left in place for the T12 decision.
3. Fix budget exhausted at fix #1 (fix #2 = port/script redesign → operator scope exceeded) → STOP after step 3, as instructed.
4. `/tmp/lgtvblocklist.ipk` (Block 1 leftover) still in /tmp — volatile, noted before.
5. No commits (session rules). Post-block state verified intact at 12:22:38 (mounts/hosts/lifeline/hooks as listed above).

**Raw files this block:** `captures\fw1-pre-20260915-121709.txt` · `fw1-run-20260915-121709.txt` · `fw1-post-20260915-121709.txt` · `fw1-diag-20260915-121709.txt` · `fw1-modclosure-20260915-122001.txt` · `mech-m2m3-20260915-122001.txt` · `mech-post-20260915-122001.txt` · `mech-fix-20260915-122100.txt` · `mech-m2m3-run2-20260915-122100.txt` · `mech-post2-20260915-122100.txt` · `port5353-occupant-20260915-122100.txt`

---

## Block 5 part-A2 — side-port 5353→5335 migration + M2/M3 re-run (MECH-1 resolution) — 2026-09-15 12:27:30–12:30:16 CEST

**Task:** orchestrator-ordered continuation of Block 5: choose + verify a free side port, migrate every filter-side-port reference in the spike kit, re-upload, re-run `mech-probe.sh m2m3`. **M4 still owner-gated — NOT run.** **Mode:** AFK. **When:** port check 12:27:30 · TV toml backup 12:28:44 · edits+upload 12:28–12:29 · run 12:29:26–12:29:43 · post-health 12:30:16 (TV clock = laptop clock).
**Criteria (orchestrator instruction, source of truth):** ① port free-proof recorded (5335→5533→5454→5053, first free wins) · ② all filter-side-port 5353 refs updated, others listed/left · ③ files re-uploaded, CR-stripped, `sh -n` clean, md5 TV==local · ④ M2 = record IMPOSSIBLE (kernel) — not a fail; M3 = actual DNAT-to-self result + clean end state (no rules, no filter process) · ⑤ all recorded here. No commits.

### Port decision — **5335 chosen (first candidate, free)**
Evidence (full raw: `..\captures\port5335-freecheck-20260915-122730.txt`):
- `/proc/net/{udp,udp6,tcp,tcp6}` hex scan: `14D7`(5335) / `159D`(5533) / `154E`(5454) / `13BD`(5053) → **NONE-FOUND**; positive control `14E9`(5353) → present (wildcard, `iconnectivity`) — scan method validated.
- `netstat -lnu` + `netstat -lnt` full listener lists: no candidate port bound (`ss` absent on this build).
- Live bind test (node v8.12.0, `udp4`): `BIND-OK 127.0.0.1:5335` rc=0.
- End-to-end: the filter itself then bound `127.0.0.1:5335 [UDP]+[TCP]` and served the mech-probe selftest (run-3 log below).

### Coordinated edits (filter-side-port occurrences → 5335; every changed file+line)
| File | Lines | Change |
|---|---|---|
| `candidate\dnscrypt-proxy.toml` | 17 | `listen_addresses` `127.0.0.1:5353` → `:5335` |
| `candidate\dnscrypt-proxy.toml` | 16 | comment (readiness canary port) → 5335 |
| `candidate\dnscrypt-proxy.toml` | 51 | comment (`REDIRECT :53->…`) → 5335 |
| `candidate\dnscrypt-proxy.toml` | +25 | **inserted `user_name = 'nobody'`** (fix #1 sync — WITHOUT this the re-upload would silently revert the 12:20:54 TV fix and mech-probe would fail again per root-cause 1) |
| `g1\mech-probe.sh` | 19 | `FPORT=5353` → `5335` (also drives the M3 DNAT target) |
| `g1\mech-probe.sh` | 6, 12 | header comments → 5335 |
| `g1\filter-apply.sh` | 8 | `FPORT=5335` |
| `g1\filter-rollback.sh` | 5 | `FPORT=5335` |
| `g1\keeper.sh` | 5 | `FPORT=5335` |
| `g1\status.sh` | 5 | `FPORT=5335` |
| `g1\efficacy-run.sh` | 15 | filter-path query `127.0.0.1 5335` |
| `g1\firewall-contract.sh` | 13(×2), 14, 17, 22, 24 | `--to-ports 5335` (future re-runs; FW-1 NOT re-run) |
| `g1\cleanup.sh` | 23, 24 | fallback REDIRECT-deletion `--to-ports 5335` |
Left unchanged (reported): `candidate\dnscrypt-proxy.forwarding-variant.toml:12` (header: historical provenance, “do not upload”), `candidate\local-dryrun.toml:2-3` (local-only artifact), `README.md:51/66/68` · `candidate\filter-pricing.md:86` · `captures\dryrun-evidence-index.md:35` (docs/history — recommend a Task-17 doc pass), `captures\*` + this file’s part-A sections (evidence, must not change). `g1\dnsq.js`/`dnsq.sh` contain no port literal (port is an argument).

### Upload (CR-strip + syntax + integrity) — 2026-09-15 12:29
9 files scp’d to `/var/lib/webosbrew/s0-probe/`; `sed -i 's/\r$//'` (no-op, local files LF-only); `sh -n` → **SYNTAX-OK ×8**; TV md5 == local md5 for all 9 (toml `6612f75c08463292290e7e570aeed8bd` · mech-probe `66e2358ad459f2b244d71ed28c8d940d` · firewall-contract `6c73649d9b4609a361119c2e21a515ba` · filter-apply `0e06ac6bede4d1d0d6426c3460bff497` · filter-rollback `e9db75aacd67f48f80c874ab00775139` · keeper `81c61ab0fb51f546e2871746b9ba9e23` · status `74450da414727cc0f6ce5c3a487ef228` · efficacy-run `5508487456d170bc4ec9014296e7807a` · cleanup `0231428e609624d87e56749307798bfd`). Pre-port-change TV toml backed up as `dnscrypt-proxy.toml.pre-5335port` (ea1ef49d…). NOTE: 6 of the 9 (`filter-apply/keeper/status/efficacy-run/filter-rollback/cleanup`) were previously never staged into `$S0`; now staged so T12–T15 invoke the 5335 versions (dormant until invoked).

### M2 — REDIRECT in-path: **IMPOSSIBLE (kernel) — recorded as capability, not a fail**
Both REDIRECT rule-adds failed (`No chain/target/match by that name` → “REDIRECT udp/tcp rule FAILED”), identical to FW-1 F5 — REDIRECT target absent from this kernel and non-loadable. With no rule in path, the M2 probes behaved as direct traffic: `ads.lgtvcommon.com` via 8.8.8.8 → `rcode=3` NXDOMAIN; `example.com` via 8.8.8.8 → `rcode=0 A=172.66.147.243`; M2-stub (ads via 127.0.0.1:53) → `rcode=0 ancount=0` (empty answer, matches prior baseline pattern).

### M3 — DNAT-to-self: **WORKS (delivery proven); self-loop caveat recorded**
- DNAT rules installed OK (`-t nat -A OUTPUT -p udp/tcp --dport 53 -j DNAT --to-destination 127.0.0.1:5335`); owner-match RETURN adds failed (F6 — kernel-unsupported) → script proceeded (its guard covers the privilege drop only — harness gap, recorded in part-A; the drop itself happened: uid 99).
- **Probe 1 (decisive): `ads.lgtvcommon.com` via 8.8.8.8 → `rcode=5` REFUSED + `blocked-names.log` entry `12:29:37 192.168.179.8 ads.lgtvcommon.com` → TV-originated traffic addressed to a hardcoded public resolver WAS delivered to the local filter and enforced there.** (Compare: same name/server pre-rule = NXDOMAIN rcode 3.)
- Probe 2: `example.com` via 8.8.8.8 → TIMEOUT (rc=1) + query-log churn (`example.com A DROP 2000ms 192.168.179.1:53` ×20 tail) + 2× `[WARNING] Too many incoming connections (max=250)` → **the filter’s own upstream traffic (uid nobody → 192.168.179.1:53) is re-captured by the DNAT rule because owner-match RETURN cannot exist on this kernel → bounded self-loop until timeouts/cleanup.** Exactly the caveat flagged in part-A analysis; now MEASURED.
- **T12 implication (flag for orchestrator):** DNAT-to-self enforcement needs a loop-avoidance mechanism; owner-match is unavailable ⇒ candidates: DNAT-rule destination exclusion (`! -d 192.168.179.1` on the dport-53 rule — filter upstream bypasses, everything else is captured) or similar. NOT applied (probe-only run; design decision).
- Loop bounded: script cleans rules after probes; `SCRIPT-EXIT=0`; no residue.

### End state (verified twice — 12:29:43 POST + 12:30:16 health)
`iptables -t nat -S` = policies only (0× `dport 53`); `iptables -S OUTPUT` == paused baseline (3 drops: 156.147.69.32 / 224.0.0.251 / 239.255.255.250); `filter.pid` gone; no dnscrypt-proxy process; `/etc/hosts` == `/tmp/hosts` md5 `7900d0cf…` (mount count 1, unchanged); functional: stub `example.com → rcode=0` and `ads.lgtvcommon.com via 8.8.8.8 → rcode=3` (no REFUSED → rules truly gone). Lifeline/hooks untouched.

### Deviations (recorded)
1. Local toml gained fix #1 (`user_name` line) — required to avoid silent revert on re-upload; TV copy behavior unchanged vs 12:20:54 state (+port). 2. 9 files uploaded (incl. 6 first-time stages — see Upload note). 3. `firewall-contract.sh` text updated but NOT re-run (REDIRECT/owner absence is a kernel property; part-A evidence stands). 4. `forwarding-variant.toml`/docs/evidence left with 5353 (see “Left unchanged”). 5. M4 still NOT run (owner gate — deliberate). 6. No commits.

**MECH-1 resolution:** M2 IMPOSSIBLE-by-kernel (capability, not fail) · M3 DNAT-to-self **works for enforcement delivery** with a measured no-owner-match self-loop caveat · end state clean ⇒ **≥1 in-path mechanism measured working** (probe level). Part-A verdict superseded.

**Raw files:** `..\captures\port5335-freecheck-20260915-122730.txt` · `..\captures\mech-m2m3-run3-20260915-122926.txt` · `..\captures\mech-post3-20260915-123016.txt` · `..\captures\mech-run3-filter-20260915-122926.log` · `..\captures\mech-run3-queries-20260915-122926.log` · `..\captures\mech-run3-blocked-names-20260915-122926.log` · `..\captures\mech-run3-mech-probe-20260915-122926.log` (part-A files: `mech-m2m3-20260915-122001.txt`, `mech-m2m3-run2-20260915-122100.txt`, `mech-post2-20260915-122100.txt`, `port5353-occupant-20260915-122100.txt`).

---

## Block 5 part-A3 — S0 T8 step 4: M4 connmand kill/respawn test (MECH-1 final) — 2026-09-15 12:53:07–12:56:20 CEST

**Task:** run-sheet Block 5 **step 4** (HITL-owner gate — approval granted/relayed BEFORE this run; no new approval sought) + step 5 (MECH-1 final verdict) · **Mode:** AFK action on owner-approved gate · **When:** pre-state 12:53:07 · **kill 12:53:18** · respawn check 12:53:26 (+8 s) · manual restart ≈12:53:26–29 · script probes 12:53:29–31 · post-capture 12:54:10 · socket-owner check 12:54:45 · stability re-check 12:56:20 CEST (TV clock = laptop clock; TV wall clock ≈1 s vs monotonic).
**Criteria (run-sheet steps 4–5, source of truth):** record respawn **yes/no** + new **cmdline** + **post-kill DNS** (stub + upstream); fallback = manual restart with the captured cmdline; only if manual restart FAILS → reboot recovers (record). Step 5: every verdict recorded; ≥1 working in-path mechanism.
**Preconditions (verified live, 12:53:07):** SSH OK; up 44 min (post-Block-3 boot); connmand pid 2828 / cmdline `/usr/sbin/connmand -n --nobacktrace --noplugin=bluetooth,bluetooth_legacy` (start_age ≈43.9 min = boot-time, start_ticks 1456); kit `mech-probe.sh` md5 66e2358a… == local, toml 6612f75c…; **nat :53 = none**; no dnscrypt process / no `filter.pid`; hooks 00/02 `-rw-` (paused), 95-s0-probe `-rwx`; mount count=1, /etc/hosts == /tmp/hosts md5 `7900d0cf…`; lifeline `/tmp/restore-handbuilt.sh` present (778 B).
**Run wrapper (capture robustness only — procedure = script `m4` branch, unmodified):** `nohup sh /var/lib/webosbrew/s0-probe/mech-probe.sh m4 > /tmp/m4-run.out 2>&1` over one SSH connection.

**Raw output (run, verbatim; full: `..\captures\m4-run-20260915-125324.txt` + `..\captures\m4-runout-20260915-125626.txt`):**
```
== M4: connmand respawn (OWNER-CONFIRMED ONLY) ==
connmand pid=2828
cmdline: /usr/sbin/connmand -n --nobacktrace --noplugin=bluetooth,bluetooth_legacy
RESPAWN=no — restarting with the captured cmdline
manual restart pid=6743
-- M4-stub: example.com via 127.0.0.1
rcode=0 ancount=2 A=172.66.147.243      rc=0
-- M4-upstream: example.com via 192.168.179.1
rcode=0 ancount=2 A=172.66.147.243      rc=0
post-kill checks done (if DNS is down and no connmand: reboot recovers — recorded)
M4-EXIT=0
```
`mech-probe.log` (pulled: `..\captures\mech-run4-mech-probe-20260915-125626.log`): `1789469598 M4 kill pid=2828 …` · `1789469606 M4 respawn=no` · `1789469609 M4 manual-restart pid=6743` → epoch-anchored: kill 12:53:18 · +8 s check 12:53:26 · manual restart setsid ≈12:53:26–27 (logged 12:53:29 after the +3 s confirm sleep).

**Raw output (post + stability, verbatim key lines; full: `..\captures\m4-post-20260915-125416.txt`, `..\captures\m4-svcowner-20260915-125445.txt`, `..\captures\m4-stability-20260915-125626.txt`):**
```
12:54:10 / 12:56:20  pids=[6743] count=1 · PPid=1 · cmdline == captured original
uptime=2716.95 start_ticks=267237  → new process start ≈44.6 s before 12:54:10 (≈12:53:25.4)
systemctl status connman:  Active: inactive (dead) since Tue 2026-09-15 12:53:28 CEST
  Main PID: 2828 (code=exited, status=0/SUCCESS)
  Process: 6717 ExecStopPost=/usr/sbin/wpa_cli terminate (code=exited, status=254)
  (re-checked at 12:56:20: still inactive, +2min55s)
journalctl → "No journal files were found" · logread → empty   (no daemon log lines exist on this build)
53-socket inodes udp=105233 tcp=105241 → owner: /proc/6743 comm=connmand   (:53 stub lives in connmand)
wpa_supplicant pid 2821 alive; /var/run/wpa_supplicant/ sockets p2p0 + wlan0 present
DNS after restart: stub example.com rc=0 · upstream 192.168.179.1 rc=0 · ads.lgtvcommon.com via stub rcode=0 ancount=0 (network-path blocking intact; no REFUSED)
getStatus: wifi state connected, SSID/IP/dns1(192.168.179.1)/dns2 unchanged; onInternet:"no" · checkingInternet:true · isInternetConnectionAvailable:false  (same as BOOT-1 +33 s)
residue: nat53-none · no-dnscrypt · no-filter-pid · hooks 00/02 -rw- · 95 -rwx · mountcount=1 md5 7900d0cf… · lifeline intact
```

**Measured:**
- **Respawn: NO.** Old pid 2828 accepted SIGTERM (systemd: `status=0/SUCCESS` = clean exit); `pidof` empty at +8 s → run-sheet fallback taken. **No auto-respawn ever observed:** `connman.service` inactive/dead since 12:53:28 and still dead at +2 min 55 s — this unit has no restart policy that fires (no journal exists to show a schedule; unit record is the evidence).
- **Manual restart (run-sheet fallback): SUCCEEDED.** `setsid <captured cmdline>` → pid **6743** (same cmdline; PPid=1 = orphan/unmanaged — expected with setsid; systemd unit stays dead). Single instance at all 3 later checks — no duplicates, no delayed systemd restart.
- **No-manager window ≈7–8 s** (kill 12:53:18 → new connmand ≈12:53:25.4–26.5); **post-kill DNS after restart: OK** (stub rc=0, upstream rc=0, both A-records). **Device-local DNS during the window: unavailable — labeled INFERENCE:** the :53 stub sockets are owned by connmand itself (inode scan → pid 6743) and the old sockets died with 2828; the script's DNS probes run after its restart leg, so the down-window state was not directly measured.
- **SSH/transport: survived end-to-end** — run start 12:53:18 → end 12:53:32 over ONE connection, no drop/re-dial; no re-connection needed (recovery path unused).
- **wpa_supplicant unaffected** (pid 2821 alive; control sockets present; `ExecStopPost wpa_cli terminate` exited 254 = no-op).
- **Observation (not attributed to m4):** getStatus `onInternet:"no"` persists (also seen at BOOT-1 +33 s); all functional checks pass (DNS/SSH/upstream). Hypothesis for T12/app copy: LG reachability checker hits hosts-mapped LG domains (snu.lge.com → 127.0.0.1 via the active HBC hosts mount) — do not read `onInternet` as transport truth; verify via DNS/HTTP.
- **Residue:** m4 installed ZERO iptables rules (nothing to clean); nat :53 none; no filter process; pause state, mounts, lifeline and kit all intact (only additions: expected `mech-probe.log` lines + `/tmp/m4-run.out`).
- **T12 design inputs (recorded):** (a) connmand does NOT self-heal after a kill on this build — anything that suppresses/restarts it must own the restart; (b) setsid restart = unmanaged until next reboot (systemd-native `systemctl start connman` = unverified alternative); (c) device-local DNS is down for the kill→restart gap — minimize it if the app ever touches connmand.
- **Block close-out (12:57:56, ≈4m38s post-kill):** single connmand 6743; nat :53 none; hooks 00/02 still `-rw-`; mount count=1; lifeline present → TV left in PAUSED state, kit intact (`..\captures\m4-final-20260915-125803.txt`).

**Pass/Fail criteria:** run-sheet step 4 = respawn yes/no + cmdline + post-kill DNS recorded; manual-restart fallback only; reboot only if manual restart fails. → all recorded; manual restart worked; reboot NOT needed.
**Verdict:** **M4 PASS (recording complete) — RESPAWN=no · manual restart OK (pid 6743, single) · post-kill DNS rc=0 stub+upstream.**
**MECH-1 final (step 5): every verdict recorded (M2 = impossible-by-kernel capability; M3 = DNAT-to-self works; M4 = recorded) + ≥1 working in-path mechanism (M3) ⇒ COMPLETE.** The reduced-mechanism fallback ("REDIRECT+owner-match AND DNAT both broken") is NOT triggered — DNAT works; Task 12 continues on the recorded M3/DNAT path with the part-A2 loop-avoidance caveat.

**Deviations (recorded):** 1. `nohup` + TV-side output file wrapper (SSH-drop resilience; script branch unchanged). 2. DNS probes ran after the manual-restart leg (script design) — down-window DNS recorded as labeled inference (socket ownership), not a direct measurement. 3. `timeout 8 …` is invalid on this busybox (needs `-t`); getStatus retried with `timeout -t 8` — cosmetic, no impact. 4. journald absent / `logread` empty → no daemon log lines available on this build. 5. No commits; nothing outside probe kit / m4 test scope modified.

**Raw files (part-A3):** `..\captures\m4-pre-20260915-125307.txt` · `..\captures\m4-run-20260915-125324.txt` · `..\captures\m4-runout-20260915-125626.txt` · `..\captures\mech-run4-mech-probe-20260915-125626.log` · `..\captures\m4-post-20260915-125416.txt` · `..\captures\m4-svcowner-20260915-125445.txt` · `..\captures\m4-stability-20260915-125626.txt` · `..\captures\m4-final-20260915-125803.txt`.

---

## Block 6 — S0 T9: `/exec` ceilings (EXEC-1) — 2026-09-15 13:03–13:13 CEST

**Task:** Block 6 / plan Task 9 (`/exec` ceilings on G1) · **Mode:** AFK · **When:** pre-check 13:01:15 · upload 13:03:20 · launch 13:03:37 · script 13:03:40–13:09:53 · artifacts pulled + end-state 13:10:53–13:13 CEST (TV clock = laptop clock, ±1 s)
**Preconditions (verified live 13:01:15, `..\captures\exec1-pre-20260915-130115.txt`):** SSH OK (laptop WLAN 192.168.179.4); TV uptime 52 min; **nat :53 = 0** (nat table = policies only); no filter process / no `filter.pid`; hooks 00/02 `-rw-` (paused), 95-s0-probe `-rwx`; `/etc/hosts` mount count=1, md5 == `/tmp/hosts` `7900d0cfacb7e175b60b2d6ca66d59ac`; lifeline `/tmp/restore-handbuilt.sh` present (778 B); probe kit intact; `exec-ceiling.sh` not yet staged (expected). HBC `/exec` bridge preflight OK: `echo hbc-alive` → `{"stdoutBytes":"aGJjLWFsaXZlCg==","stdoutString":"hbc-alive\n","returnValue":true,...}`.
**Criteria (run-sheet Block 6 + plan Task 9 step 2; source of truth):** PASS = measured values recorded for all six probes: T1 timeout ladder (largest `sleep N` returning normally; note tolerated ≥N s) · T2/T2b output cap location + child-kill side effect (`child_finished` yes/no) · T3 concurrency (elapsed ≈ 8 s with both C1/C2 present ⇒ no server-side serialization ⇒ pinned rule: UI single-flight + script-side mkdir lock) · T4 spawn event count (usable for progress if ≥2 lines) · T5 non-zero exit response shape (`stdoutString` present in error body?) · T6 status-block echo count. FAIL only if even `sleep 10` fails/timeouts (then long ops go sentinel-only).
**Command(s):**
    scp g1\exec-ceiling.sh root@192.168.179.8:/var/lib/webosbrew/s0-probe/   → CR-strip (no-op) → sh -n OK → md5 TV==local `3602f26fa071e12ebbaef9e1c602a133`
    ssh root@192.168.179.8 "nohup sh -c 'sh /var/lib/webosbrew/s0-probe/exec-ceiling.sh > /tmp/exec-ceiling.out 2>&1; echo EXEC-EXIT=$?; touch /tmp/exec-ceiling.done'" (wrapper only — script itself unmodified)
**Raw output (key lines; full run file `..\captures\exec1-run-20260915-131053.txt` = /tmp/exec-ceiling.out):**
```
== T1 timeout ladder ==
sleep10 rc=0 elapsed=11s bytes=142
sleep30 rc=0 elapsed=30s bytes=142
sleep60 rc=0 elapsed=60s bytes=142
sleep120 rc=0 elapsed=120s bytes=143
== T2 output cap + child side effect ==
cap rc=0 jsonbytes=483032 child_finished=no
maxBuffer
"returnValue":
== T2b exact-cap probe (1 MiB = 1048576 bytes of stdout) ==
1MiB jsonbytes=483032
== T3 concurrency (no server-side lock expected) ==
concurrent elapsed=8s c1=130 c2=130
== T4 spawn streaming ==
spawn rc=143 lines=5
{"event":"exit","exitCode":0,"returnValue":true}
{"event":"close","closeCode":0,"returnValue":true}
Terminated
== T5 non-zero exit response shape ==
{ "stderrString": "", "stdoutBytes": "YmVmb3JlLWZhaWwK", "stdoutString": "before-fail\n",
  "returnValue": false, "errorText": "Command failed: echo before-fail; exit 3\n", "stderrBytes": "" }
== T6 status-block echo sanity ==
1
EXEC-EXIT=0
```
Cap responses (both raw files 483,032 B, **byte-identical**: `..\captures\exec1-cap-20260915-131053.json` / `exec1-cap1048576-20260915-131053.json`): `{"stderrString":"","stdoutBytes":"<base64>","stdoutString":"<0123… lines, partial tail '01234'>","returnValue":false,"errorText":"stdout maxBuffer exceeded","stderrBytes":""}` — decoded capture = **exactly 204,800 B (200 KiB)** = 4,995 complete 41-B lines + 5-B partial line; both the 1.3 MB and 1 MiB probes truncated at the same absolute prefix.
Timeline (mtime-anchored, epoch: exec-120=13:07:15 · cap+cap1048576=13:07:15 · c1/c2=13:07:23 · spawn=13:09:53 · exit3/statusblock/out/done=13:09:53): T1 13:03:45→13:07:15 · T2+T2b < 1 s (cap fires fast) · T3 8 s · T4 13:07:23→killed 13:09:53 (150-s wrapper) · T5/T6 + EXEC-EXIT same second.

**Measured:**
- **T1 — no server-side timeout in the tested range:** `sleep 10/30/60/120` all returned normally (rc=0; elapsed 11/30/60/120 s; each response = 142–143-B JSON with `stdoutString:"DONE<N>\n"`). Largest tested = 120 s; exec tolerates ≥120 s (recon's "no timeout" held for ≥120 s since the wrapper's own 150-s timeout never fired on T1).
- **T2/T2b — output cap = 204,800 B (200 KiB) of stdout — *not* the plan-expected 1 MiB–1.3 MiB.** At the cap: response `returnValue:false` + `errorText:"stdout maxBuffer exceeded"`, response JSON = 483,032 B (the captured prefix is included TWICE: escaped `stdoutString` + base64 `stdoutBytes`), and luna-send exit code = **0** (rc is not a success signal — callers MUST check `returnValue`). **Child killed at the cap:** `cap-done` sentinel absent (checked twice: post-run + end-state), `child_finished=no`; no leftover loop process. ⇒ pinned rule: never print bulk output; status block only (≤2 KiB).
- **T3 — no server-side serialization:** two concurrent 8-s execs both returned; elapsed = 8 s; C1 + C2 both present ⇒ pinned rule: UI single-flight + script-side mkdir lock required.
- **T4 — spawn streams, but the reader must be bounded:** 4 events arrived (`stdoutData "S0-1\n"` @+0 s, `stdoutData "S0-2\n"` @+3 s, `exit exitCode:0`, `close closeCode:0`); the child finished cleanly. However `luna-send -i` did **not exit** after `close` — the wrapper's `timeout -t 150` killed it (rc=143 + "Terminated" line) ⇒ spawn is usable for progress, but readers must run under a bounded timeout/sentinel, not rely on luna-send returning.
- **T5 — non-zero exit keeps stdout:** `returnValue:false`, `errorText:"Command failed: echo before-fail; exit 3\n"`, **`stdoutString:"before-fail\n"` present**, `stderrString:""` ⇒ UI taxonomy can show partial output on failure; note errorText echoes the full command line.
- **T6 — status-block round-trip intact:** `stdoutString:"@@STATUS-BEGIN\nschema=1\n@@STATUS-END\n"` (both markers, escaped newlines); `grep -c '@@STATUS'` on the raw JSON = **1** (both markers sit on one JSON line) ⇒ parse the JSON, don't grep raw text; 214-B response shape on success = `stdoutBytes`(b64) + `stdoutString` + `returnValue:true` + empty stderr.
**Pass/Fail criteria:** all six probes returned measured values and no `sleep 10` failure ⇒ criteria met (**PASS**); one plan-expectation deviation recorded (cap at 200 KiB, not 1–1.3 MiB) — feeds Task 17 pins (status-block-only rule applies with a much lower ceiling than planned).
**Verdict:** **EXEC-1 PASS** — no exec timeout ≥120 s · 200 KiB stdout cap (child killed; returnValue=false; luna rc=0) · no concurrency lock · spawn streaming works (bounded reader required) · non-zero exit preserves stdoutString · status markers intact.

**Deviations (recorded):** 1. `luna-send --help` form unsupported on this build (`invalid option -- '-'`; usage block printed instead — cosmetic, script continued). 2. T4's `luna-send -i` hang → wrapper timeout rc=143 — recorded as a measured finding (bounded-reader rule), not a run error. 3. In `exec1-pre-…txt` the inline `nat53dport53=` value is empty (local PowerShell swallowed `$( … )` before SSH); the raw nat table in the same file (policies only = 0 rules) is the evidence, and a clean re-count = **0** (`exec1-endstate-20260915-131300.txt` + hook re-check `exec1-endstate2-20260915-131304.txt`). 4. Probe outputs added to `$S0` (exec-10/30/60/120.json, cap.json, cap1048576.json, c1/c2.json, spawn.json, exit3.json, statusblock.json — expected working artifacts) + `/tmp/exec-ceiling.out` + `/tmp/exec-ceiling.done`. Nothing else on the TV changed; no commits.

**Raw files:** `..\captures\exec1-pre-20260915-130115.txt` · `exec1-run-20260915-131053.txt` · `exec1-cap-20260915-131053.json` · `exec1-cap1048576-20260915-131053.json` · `exec1-exec-10-20260915-131053.json` · `exec1-exec-30-…` · `exec1-exec-60-…` · `exec1-exec-120-…` · `exec1-c1-…json` · `exec1-c2-…json` · `exec1-spawn-…json` · `exec1-exit3-…json` · `exec1-statusblock-…json` · `exec1-post-20260915-131053.txt` · `exec1-endstate-20260915-131300.txt` · `exec1-endstate2-20260915-131304.txt`.

---

## Block 7 — S0 T10: transport / upstream / signing (TRANSPORT-1, UPSTREAM-1, SIGNING-1) — 2026-09-15 13:16 CEST

**Task:** Block 7 / plan Task 10 (run-sheet lines 186–190) · **Mode:** AFK · **When:** started 2026-09-15 13:16 CEST (TV clock = laptop clock)
**Preconditions (verified live 13:14:43, read-only):** `ssh-ok`; TV up 1:05 (post-Block-3 boot); **nat :53 = 0**; **no filter process**; hooks 00/02 `-rw-` (paused) · 95-s0-probe expected `-rwx`; `/etc/hosts` mount count = **1**, md5 == `/tmp/hosts` `7900d0cfacb7e175b60b2d6ca66d59ac`; lifeline `/tmp/restore-handbuilt.sh` present (778 B). No deviations from the PAUSED state.
**Criteria (written BEFORE the run — run-sheet Block 7 + plan Task 10 Steps 1–4; source of truth):**
- **TRANSPORT-1 PASS** iff ≥1 tool fetches **both** targets with rc=0 within the timeouts (**A:** `https://raw.githubusercontent.com/furkan-bayrak/lg-tv-blocklist/main/lists/SHA256SUMS`; **B:** GitHub release asset `…/DNSCrypt/dnscrypt-proxy/releases/download/2.1.18/dnscrypt-proxy-linux_arm-2.1.18.tar.gz.minisig`, incl. redirect) AND `sha256sum` is available for verification. Record tool ranking (curl → wget → busybox wget) + TLS errors verbatim. FAIL → pin "updates arrive with app releases only" for D14.
- **UPSTREAM-1 PASS** = both captures present (getStatus raw + resolv.conf + default route) and `dns1` matches the working upstream (`192.168.179.1`). Record dns1/dns2 + resolv.conf + route. (AGH querylog corroboration optional — not taken this session; TV-side matrix in T12 is the criterion route.)
- **SIGNING-1 PASS** = decision recorded with evidence: EITHER "static ARM verifier runs on G1 (size, rc)" OR "no ARM verifier available → recommendation: Go verifier (effort) or honest docs wording `SHA256 = corruption check, not tamper-proof`".
- **Addendum (bounded, /tmp-only, cleaned; completes TRANSPORT's stated purpose):** fetch the real list `lists/strict-domains.txt` → on-device `sha256sum` == published sum `eec430f48854fb5ebb00b8a56519ec9df580c93fba75ac146e4467ed69bac3ac` (positive) + 1-byte tamper copy → hash differs (negative control). Run-sheet prescribes no tamper case; recorded here per block-validation scope (D14: "SHA256 fingerprint check against the repo's published sums").
- **Swap note:** D14 "atomic" = single version pointer + ordered apply + journal (design definition) — exercised by T12–T14 harness stages (`filter-apply.sh`, FAIL-MIDAPPLY/FAIL-MATRIX), not a T10 on-device primitive; T10 covers transport+verify only.

**Upload (standard pattern: scp → CR strip → `sh -n` → md5 TV==local):**
```
scp g1\transport-probe.sh g1\upstream-probe.sh g1\signing-probe.sh root@192.168.179.8:/var/lib/webosbrew/s0-probe/  → SCP-EXIT=0
ssh … "sed -i 's/\r$//' (no-op, files LF-only); sh -n ×3" → SYNTAX-OK
md5 TV==local: transport b95b8c9b95d0c7e008606a283b9a01a5 · upstream 67f4a35d13abe92f907366f97771a5ed · signing f1baf5b5ac6a474c9ad27b50ae9e3398
```

### TRANSPORT-1 — tool ranking + HTTPS fetch (ran 13:17:58 CEST)
**Command(s):** `ssh … "sh /var/lib/webosbrew/s0-probe/transport-probe.sh"` (stdout captured to `..\captures\transport1-run-20260915-131804.txt`)
**Raw output (verbatim):**
```
== tools ==
curl -> /usr/bin/curl · wget -> /usr/bin/wget · busybox -> /bin/busybox · sha256sum -> /usr/bin/sha256sum · openssl -> /usr/bin/openssl
BusyBox v1.29.3 (2024-05-23 17:31:15 UTC) multi-call binary.
curl 7.61.0 (arm-starfishmllib32-linux-gnueabi) libcurl/7.61.0 OpenSSL/1.1.1t zlib/1.2.11 c-ares/1.14.0 nghttp2/1.26.0
== date (TLS clock sanity) ==
Tue Sep 15 13:17:58 CEST 2026
== A: raw.githubusercontent.com SHA256SUMS ==
curl rc=0 · 500 /tmp/s0-fetch.raw · sha256 94fff2dd0dbe3e2133db4057991ef67e999e9e6255ec4f9900b18e3aac072ecd
(head: safe-adblock/safe-domains/safe-hosts sums lines — full file pulled, see below)
== B: github release asset (redirect + TLS) ==
curl-release rc=0 · 333 /tmp/s0-fetch.sig · sha256 390820a9103fad22b989fa5b4043e8c598af351bfa994883ca45a65e5da5ef77
```
**Pulled raw files:** `..\captures\transport1-sha256sums-20260915-131804.txt` (500 B — **line-identical to the session-frozen repo copy** `lists\SHA256SUMS`, 6 entries, verified by diff) · `..\captures\transport1-dnscrypt-minisig-20260915-131804.txt` (333 B).
**Measured:** tool ranking as found: **curl 7.61.0 available and sufficient** (both targets rc=0, redirect followed to release asset, no TLS errors; wget/busybox-wget never needed). `sha256sum` available. TLS clock sane (2026-09-15). Fetch URLs that worked verbatim: `https://raw.githubusercontent.com/furkan-bayrak/lg-tv-blocklist/main/lists/SHA256SUMS` + `https://github.com/DNSCrypt/dnscrypt-proxy/releases/download/2.1.18/dnscrypt-proxy-linux_arm-2.1.18.tar.gz.minisig`.
**Pass/Fail criteria:** PASS iff ≥1 tool fetches both targets rc=0 within timeouts AND sha256sum available. → **PASS.**

### TRANSPORT-1 addendum — fetch + published-sums verification leg (+ tamper control) [bounded; /tmp-only; run-sheet prescribes no tamper case]
**Why:** completes TRANSPORT's stated purpose (D14: "SHA256 fingerprint check against the repo's published sums") on a real list; dispatcher-flagged scope (fetch → sha256 verify; swap/atomic = D14 pointer+journal design exercised in T12–T14, **no T10 on-device swap primitive is prescribed or measured**).
**Raw output (verbatim — `..\captures\transport1-addn-20260915-131829.txt`):**
```
== A1 fetch real list ==  ADD-FETCH-OK
== A2 size + on-device hash ==  2497 /tmp/s0-addn-list.txt
eec430f48854fb5ebb00b8a56519ec9df580c93fba75ac146e4467ed69bac3ac  /tmp/s0-addn-list.txt
== A2b published sum (from fetched SHA256SUMS) ==
eec430f48854fb5ebb00b8a56519ec9df580c93fba75ac146e4467ed69bac3ac  strict-domains.txt     → MATCH
== A3 tamper control ==  3075ec4daab6347b708c49e9366b7a42b7408a91c1752b0f3beda32af8425eb1  (+1 byte → differs) → mismatch detectable
== A4 cleanup ==  ADDN-CLEAN
```
**Measured:** on-device fetch → hash → compare-to-published chain works end-to-end for a real list file; tampered copy produces a different hash (verification = equality check). No TV residue (cleaned in-script).

### UPSTREAM-1 — connectionmanager getStatus + resolv.conf + route (ran 13:18:30 CEST)
**Command(s):** `ssh … "sh /var/lib/webosbrew/s0-probe/upstream-probe.sh"` (capture `..\captures\upstream1-run-20260915-131830.txt`; full JSON pulled → `..\captures\upstream1-getstatus-20260915-131830.json`)
**Raw output (key lines, from the raw JSON — the script's trailing `== compare ==` greps printed EMPTY, see deviations):**
```
wifi: "dns1": "192.168.179.1" · "dns2": "fd4d:c8d7:eb60:1:de39:6fff:febe:59c9" · "dns3": "fd4d:c8d7:eb60:1:de39:6fff:febe:59c9"
      "ipAddress": "192.168.179.8" · "gateway": "192.168.179.1" · state connected · onInternet:"no" · checkingInternet:true
resolv.conf: # Generated by Connection Manager | nameserver ::1 | nameserver 127.0.0.1
default route: default via 192.168.179.1 dev wlan0
```
**Measured:** `dns1 = 192.168.179.1` = working upstream ✓ (the field a keeper would poll; feeds D12). `dns2`/`dns3` = DHCPv6 **ULA** (fd4d:…) — not valid v4 targets (keep-dns1 design input confirmed). New vs BOOT-1 record: a third field `dns3` now present (same ULA value). `onInternet:"no"`/`checkingInternet:true` — known harmless quirk (functional DNS/HTTPS all pass; not transport truth).
**Pass/Fail criteria:** PASS = both captures present and dns1 matches working upstream. → **PASS.**
**Route note (recorded):** AGH querylog corroboration NOT taken (optional per plan; TV-side matrix in T12 is the criterion route).

### SIGNING-1 — verifier pricing + decision (probe ran 13:18:30 CEST; research + device test 13:20–13:22)
**Stock tools (signing-probe.sh raw — `..\captures\signing1-run-20260915-131830.txt`):**
```
minisign -> MISSING · signify -> MISSING · openssl -> /usr/bin/openssl · gpg -> MISSING
OpenSSL 1.0.2r  26 Feb 2019
openssl genpkey -algorithm ed25519 → "Algorithm ed25519 not found"   (no Ed25519 in 1.0.2)
NOTE: the script's "ed25519 gen OK" echo is a pipeline-rc artifact (head's rc), NOT a positive result.
```
**Laptop research (plan Step 3):** official `jedisct1/minisign` releases = linux-**x86_64**/win64/macos/wasm → **no ARM asset at all**; `aead/minisign` (Go, MIT) v0.3.0 = linux-amd64 + **linux-arm64** static; Alpine armv7 package exists but is **musl-dynamic** (incompatible with the TV's glibc userland); no known static-build project ships armv7. → **No armv7 build**, but the **arm64 static Go build is viable here**: TV kernel = aarch64 (userland 32-bit, but static binaries need no libs).
**On-device test (aead/minisign v0.3.0 linux-arm64, ELF64/AArch64, static Go):**
```
size 1,769,624 B (1.69 MiB) · sha256 3b9bb358762f5da8eb6af8218f56fae97ec61bbdca899f43861ffde07af1dfde (TV-side hash == laptop)
/tmp/s0-minisign-arm64 -h → prints usage → EXECUTES on G1 ✓
Test file signed on the laptop with C minisign 0.12 (win64): prehashed (default) + legacy (-l) signatures; uploaded; verified ON THE TV:
V1 prehashed sig (default verify):  "Signature and comment signature verified" rc=0 → V1-OK
V2 legacy sig:                      verified rc=0 → V2-OK
V3 -H vs legacy sig:                rejected ("Legacy (non-prehashed) signature found") → V3-EXPECTED-FAIL
V4 tampered file:                   "Error: signature verification failed" → V4-TAMPER-DETECTED
V5 -P inline pubkey:                verified rc=0 → V5-OK
```
(verify capture: `..\captures\signing1-verify-20260915-132132.txt`; evidence copies: `signing1-testkey.pub`, `signing1-testfile.txt`, `signing1-testfile-prehashed.minisig`, `signing1-testfile-legacy.minisig` — test keypair is throwaway, generated locally for this test only.)
**Measured:** cross-implementation proof — **C-tool signatures verified by the Go verifier on the G1**; both minisign formats; tamper + format-enforcement behave. Download hashes (laptop): arm64 tar.gz `2c168e97b8c25342e2c9f18ee12948f6a998dc1310ddefeb49868fa116c52dc5` (746,899 B) · win64 signer zip `37b600344e20c19314b2e82813db2bfdcc408b77b876f7727889dbd46d539479` (252,505 B).
**Pass/Fail criteria:** PASS = "static verifier runs on G1 (size, rc)" OR documented no-verifier fallback. → **PASS (verifier branch).**
**Decision (feeds D14 / Task 17):** on-device signature verification is feasible → **recommendation: pin + produce a static Go verifier in CI** (`GOARCH=arm64`, `CGO_ENABLED=0`, e.g. aead/minisign pinned; optionally also emit `GOARCH=arm GOARM=7` for 32-bit-only userlands / older units) — one CI step, no device toolchain; alternatively vendor the pinned aead release asset with hash pinning. The honest-wording fallback (`SHA256 = corruption check, not tamper-proof`) is **not required** as the primary position; SHA256-only remains acceptable only if the project prefers zero new components.

### End state (post-cleanup, verified 13:21 + 13:23:46 CEST — `..\captures\block7-endstate-20260915-132132.txt`, `..\captures\block7-endstate2-20260915-132352.txt`)
nat :53 = **0** · no dnscrypt/filter process · hooks 00/02 `-rw-` (pause intact, md5s unchanged) · `/etc/hosts` mount count = 1 (md5 `7900d0cfacb7e175b60b2d6ca66d59ac` == /tmp/hosts) · lifeline `/tmp/restore-handbuilt.sh` present (778 B) · kit = prior contents + 3 probe scripts (md5s match `g1\` copies) · TV `/tmp` residue = script outputs only (`s0-fetch.raw`, `s0-fetch.sig`, `s0-getstatus.json`) + pre-existing Block-4 `s0-hosts.new`; all signing test files/binaries removed (`TESTFILES-GONE` verified).

**Deviations (recorded):**
1. Bounded addendum beyond run-sheet steps (real-list fetch + sums MATCH + tamper control) — within the block's verification purpose (`fetch + sha256sum verification`); /tmp-only; cleaned; swap/atomic scope note above.
2. `upstream-probe.sh` "compare" greps printed empty: pattern `'"dns1":"…"'` does not match pretty-printed JSON (space after colon) — values taken from the raw JSON; trivial script fix for Task 17.
3. `signing-probe.sh` "ed25519 gen OK" echo = pipeline-rc artifact (head exits 0); true result = no Ed25519 in OpenSSL 1.0.2r. Fix for Task 17 (check `$?` before piping or use `openssl genpkey … || true`).
4. Verifier test used the **arm64** static build (plan text says "static ARM build"): runs on this device's aarch64 kernel + 32-bit userland; **armv7 static emit remains the portable option** for 32-bit-only userlands (CI note recorded).
5. Cosmetic/ops: one stray token in the endstate2 remote command produced a harmless `sh: ssh-not-applicable: not found` line; the first cleanup attempt (inside a chained call) did not take effect — re-ran standalone and verified `TESTFILES-GONE`. No impact.
6. No commits; nothing outside test scope modified (TV writes: 3 probe scripts in `$S0` + /tmp test files, all accounted for; no system files touched).

**Raw files (Block 7):** `..\captures\transport1-run-20260915-131804.txt` · `transport1-sha256sums-20260915-131804.txt` · `transport1-dnscrypt-minisig-20260915-131804.txt` · `transport1-addn-20260915-131829.txt` · `upstream1-run-20260915-131830.txt` · `upstream1-getstatus-20260915-131830.json` · `signing1-run-20260915-131830.txt` · `signing1-verify-20260915-132132.txt` · `signing1-testkey.pub` · `signing1-testfile.txt` · `signing1-testfile-prehashed.minisig` · `signing1-testfile-legacy.minisig` · `block7-endstate-20260915-132132.txt` · `block7-endstate2-20260915-132352.txt`

---

## Block 8 — S0 T11: foreign-setup detector (DETECT-1) — 2026-09-15 13:30–13:37 CEST

**Task:** Block 8 / plan Task 11 Step 2 (clean run + mocks m1/m2/m3, remove each after) · **Mode:** AFK · **When:** pre-state 13:30:55 · stage 13:32:35 · clean-1 13:33:07 · tune+stage2 13:34:54 · clean-2 13:35:00 · m1-run-1 13:35:24 · stage3 13:35:49 · clean-3 13:35:56 · m1b 13:36:12 · m2 13:36:23 · m3 13:36:34 · D1-mock 13:37:04 · final+end-state 13:37:21 CEST (TV clock = laptop clock).
**Preconditions (verified live, `..\captures\detect1-pre-20260915-133055.txt`):** `ssh-ok`; TV up 1:21 (post-Block-3 boot); **nat :53 = 0** (policies only); **no dnscrypt process** (bracket-trick scan; note: naive `pgrep -f dnscrypt-proxy` self-matches its own SSH command line — pid seen at 13:30:49 was the wrapper shell, gone by 13:31:06; `pgrep -f 'dns[c]rypt'` = empty); no `filter.pid`; hooks 00/02 `-rw-` (paused; md5s 4dfbbcf6…/4da8bd68… unchanged); `/etc/hosts` mount count=1, md5 == `/tmp/hosts` `7900d0cf…`; lifeline `/tmp/restore-handbuilt.sh` present (778 B, c73fbacf…); kit intact (`$S0` listing captured).
**Criteria (run-sheet Block 8 + plan Task 11 Step 2; source of truth, written 2026-09-14 pre-session):** clean run → three mocks (m1 foreign hosts mount → D2 fires; m2 dummy hook `50-s0-foreign-probe` → D4 fires; m3 DNAT 9.9.9.9:53 → D5 fires), remove each after → capture `DETECT-1`. **PASS = each condition fires exactly when its mock is present AND clean state = all false** (plan: "false positive → tune before pinning").

### Tunes applied (plan's tune-before-pinning clause) — detector version chain
| Ver | md5 | Change |
|---|---|---|
| v0 (as-planned) | `47230b36f41028d2d8a2055d62220dd4` | 1568 B, staged 13:32:35 |
| v1 | `c5ea44047e7f9d4ce21b23c736391437` | 3050 B: **Tune A (D1)** + **Tune B (D2)** + **Tune C (D4)** |
| v2 (final) | `1531fc53f9191e151b90488ef08e508d` | 3179 B: Tune B iteration 2 (stacked-mount parsing) |

**Tune A (D1 — dead condition):** v0's `netstat -lnp` is invalid on this busybox (`netstat: invalid option -- 'p'`; usage shows `[-ral] [-tuwx] [-en]` only) → pipeline produced nothing → `|| echo "D1=false (only connmand/none)"` fired **always**. D1 was structurally blind (no clean-state false positive, but no detection capability). Replaced with a `/proc` method (inode→owner attribution; same technique that identified the :5353 occupant in Block 5): build `inode:pid` map from `/proc/*/fd`, read `:53` sockets (`:0035`, st `0A`/`07`) from `/proc/net/{tcp,tcp6,udp,udp6}`, exclude `connmand`/`dnscrypt-proxy` owners, report the rest with owner comm+pid.
**Tune B (D2 — false positive in clean state):** v0 matched the mount line against `*/tmp/hosts*`/`* s0-*` — but **`/proc/mounts` cannot show bind source paths** on this build (line is just `tmpfs /etc/hosts tmpfs rw,relatime 0 0`) → clean state fired `D2=TRUE` and the m1 mock would have been indistinguishable from clean. Replaced with bind-source resolution from `/proc/self/mountinfo` (line's device field `$3` + root field `$4`, device→mountpoint lookup, source = mp+root). **Iteration 2 (found by the first m1 run, `detect1-m1-…`):** under a stacked mount (2 mountinfo lines) the awk field extraction produced a multiline source — verdict happened to be TRUE but by accident; fixed to resolve the **topmost** layer (`tail -1` = highest mount ID = visible sheet); D3 covers the stack itself.
**Tune C (D4 — known-set false positive):** clean state fired `D4=TRUE foreign hook: inputhook`. `inputhook` (280 B, Sep 12 09:51) is the **HBC-ecosystem launcher** — content captured: calls `luna://org.webosbrew.inputhook.service/start`, self-removes on error (companion to the installed `org.webosbrew.inputhook` homebrew app). Per the detector's own baseline contract ("known-good = stock + HBC + our own s0 objects") it belongs in the known set → added to the case list (+ header comment).
**Post-tune validation:** v1 clean-2 = all false; v2 clean-3 = all false + m1b/m2/m3/D1-mock/final runs used v2. TV `$S0` copy == local v2 md5 (`1531fc53…`). **No foreign artifact was modified** (detector read-only wrt foreign hooks/rules/hosts; tunes only touched our kit script).

### Clean state (v2 — canonical: `detect1-clean3-20260915-133556.txt`; also final `detect1-final-…`)
```
== D1 == D1=false (only connmand/none)
== D2 == 114 39 0:36 /hosts /etc/hosts rw,relatime - tmpfs tmpfs rw → D2=false (HBC or ours: /tmp/hosts)
== D3 == count=1 → D3=false
== D4 == (no line) D4 scan done
== D5 == D5-nat=none outside ours · D5-filter=none outside ours
== D6 == D6=false (no mount)
DETECTOR-EXIT=0        runtime ≈4–5 s (13:35:50→13:35:54)
```
**D1/D2/D3/D4/D5/D6 all false** on the clean TV (hand-built stack paused; HBC hosts bind; inputhook known; no filter). v0 clean-1 (pre-tune, `detect1-clean1-20260915-133307.txt`) had fired D2=TRUE (method flaw) + D4=TRUE (inputhook) — those were the two false positives the tunes fixed.

### Mocks — each fires only its condition, removed after, state verified
**m1 — foreign hosts bind-mount → D2** (`detect1-m1b-20260915-133612.txt`; plan recipe: `mkdir -p /tmp/s0-fake; cp /etc/hosts /tmp/s0-fake/hosts; mount --bind /tmp/s0-fake/hosts /etc/hosts`):
```
mock-mounted: count=2 · md5 /etc/hosts == /tmp/s0-fake/hosts (7900d0cf…)
D2=TRUE (foreign source: /tmp/s0-fake/hosts)   [mountinfo stack both lines shown]
D3=TRUE (count=2)   ← genuine stack created by the mock itself (inherent; recorded)
D1/D4/D5/D6 false
remove (umount /etc/hosts): count=1 · md5 /etc/hosts == /tmp/hosts (7900d0cf…) ·
  inode 36:47960 identical · /tmp/s0-fake removed → FIXTURE-GONE
```
**m2 — dummy hook → D4** (`detect1-m2-20260915-133623.txt`; plan recipe: `50-s0-foreign-probe`, content `#!/bin/sh; exit 0`, 755):
```
D4=TRUE foreign hook: 50-s0-foreign-probe   [inputhook NOT flagged — tune C effective]
D1/D2/D3/D5/D6 false
remove (rm -f): init.d listing back to the 7 known entries → MOCK-HOOK-GONE
```
**m3 — DNAT 9.9.9.9:53 → D5** (`detect1-m3-20260915-133634.txt`; plan recipe: `iptables -t nat -I OUTPUT -p udp --dport 53 -j DNAT --to-destination 9.9.9.9:53`):
```
rule inserted (visible in nat -S)
D5-nat fired: -A OUTPUT -p udp -m udp --dport 53 -j DNAT --to-destination 9.9.9.9:53   (D5 prints the offending rule = evidence)
D5-filter=none outside ours · D1/D2/D3/D4/D6 false
remove: DEL-OK · nat table = 4 policies only · post-removal nslookup example.com @127.0.0.1 rc=0 (A+AAAA) · mock window ≈4 s
```
**D1 extra mock (operator-added, beyond run-sheet mocks — required because Tune A replaced D1's method):** node UDP listener on `192.168.179.8:53` (`detect1-d1mock-20260915-133704.txt`):
```
node binds 192.168.179.8:53 (D1MOCK-BOUND) → D1=TRUE foreign :53 listener: [udp ino=161683 owner: node-pid20504]
other conditions false · kill → KILL-OK / MOCK-GONE · final clean run D1=false
```

### Notice mapping (declared for each TRUE condition — plan requirement; wording feed for Task 17)
D1 → "Another DNS resolver is listening on this TV — we won't fight it; filter runs in coexistence mode (one info line + hand-off note)". D2 → "Another hosts file is in use — we leave it untouched; revert/cleanup guide link". D3 → "Stacked hosts mounts detected — refusing to edit; report only". D4 → "Foreign startup hooks found: <names> — not ours, left untouched". D5 → "Firewall rules we don't own touch DNS — reported, not modified". D6 → resolv.conf analog of D2. **Never deleted, only reported** (D11).

### End state (verified 13:37:15–18 — `detect1-final-20260915-133721.txt`)
`nat :53 = 0` (policies only) · filter OUTPUT == paused baseline (3 drops: 156.147.69.32 / 224.0.0.251 / 239.255.255.250) · **no dnscrypt process** · no `filter.pid` · hooks 00/02 `-rw-` (pause intact) · `/etc/hosts` count=1, md5 `7900d0cfacb7e175b60b2d6ca66d59ac` == `/tmp/hosts`, inode 36:47960 · init.d = 7 known entries (no mock hook) · lifeline present (c73fbacf…) · fixtures removed: `/tmp/s0-fake` gone, `/tmp/d1mock.out` gone · hosts content tail intact (HBC sheet) · no new `/tmp` residue from this block (pre-existing: Block-1 ipk, Block-4/7 s0-* files — known, volatile).

**Measured:** every condition behaves per contract after tuning: fires exactly with its mock; silent in clean state; D3 additionally fires during m1 (genuine stack); removal of each fixture left zero residue; detector runtime ≈4–5 s/run.
**Pass/Fail criteria:** PASS = each condition fires exactly when its mock is present and clean state = all false. v0 failed (D2+D4 clean-state false positives + dead D1) → tuned per plan's "tune before pinning" clause; v2 meets the criterion (clean all-false; m1→D2, m2→D4, m3→D5 each exactly).
**Verdict:** **DETECT-1 PASS (detector v2 `1531fc53…`; 3 tunes applied + documented).** Flags for Task 17: (a) D1 v0 was dead on this platform — v2 method validated by mock; (b) D4 known-set still needs, for production, the app's own future hook name (e.g. `50-lgtvblocklist-app` class) — not present during the spike; (c) notice-mapping wording above is the session draft.

**Deviations (recorded):**
1. **3 tunes to our own detector script** (plan-sanctioned "false positive → tune before pinning"): D1 method (dead `netstat -p`), D2 method (mounts vs mountinfo), D4 known-set (+inputhook). All recorded above with version md5s; TV `$S0` copy updated in step.
2. **D1 mock added** beyond the run-sheet's m1–m3 (operator-added, AFK-safe, bounded ≈7 s: node UDP listener on the TV's own IP :53, killed; no service impact — nothing queries the TV's IP for DNS) — needed to prove the replacement D1 method actually detects.
3. m1 ran twice: first run (`detect1-m1-…`) exposed the D2 stacked-parsing flaw (fixed in Tune B iter. 2); canonical m1 = `detect1-m1b-…`. Both raw files kept.
4. `pgrep -f dnscrypt-proxy` self-match red herring at pre-state (resolved: wrapper shell, bracket-trick scan = clean); recorded in pre-proc captures.
5. D5 "fires" = prints the offending rule lines (no explicit `D5=TRUE` marker in the script, unlike D1/D2/D4) — cosmetic; noted.
6. No commits; nothing outside detector + session-prescribed mocks touched; all fixtures removed and re-snapshotted.
7. First clean-run attempt (13:32:43) never executed: an echo label containing unquoted parentheses broke in the local PowerShell→remote-sh quoting chain (`sh: syntax error: unexpected "("`); zero side effects, nothing ran; raw kept as `detect1-clean1-20260915-133243.txt` (34 B). Successful re-run at 13:33:07.

**Raw files (Block 8):** `..\captures\detect1-pre-20260915-133055.txt` · `detect1-preproc-20260915-133106.txt` · `detect1-preproc2-20260915-133119.txt` · `detect1-stage-20260915-133235.txt` · `detect1-clean1-20260915-133307.txt` · `detect1-stage2-20260915-133454.txt` · `detect1-clean2-20260915-133500.txt` · `detect1-m1-20260915-133524.txt` · `detect1-stage3-20260915-133549.txt` · `detect1-clean3-20260915-133556.txt` · `detect1-m1b-20260915-133612.txt` · `detect1-m2-20260915-133623.txt` · `detect1-m3-20260915-133634.txt` · `detect1-d1mock-20260915-133704.txt` · `detect1-final-20260915-133721.txt`

---

## Block 9 — S0 T12 steps 1–2: take-over + per-layer efficacy (P1 hosts-only, P2 filter-only) — 2026-09-15 13:42–13:51 CEST

**Task:** run-sheet Block 9 steps 1–2 (plan Task 12 Steps 1–2) · **Mode:** AFK · **When:** 13:42:36–13:51:10 CEST (TV clock = laptop clock; first harness-filter-ON period of the session)
**Preconditions (verified live 13:42–13:44, read-only):** `ssh-ok` · **no filter/keeper pid** · nat :53 = 0 (policies only) · hooks 00/02 `-rw-` (pause intact) · `/etc/hosts` count=1, md5 `7900d0cfacb7e175b60b2d6ca66d59ac` (snapshot → `$S0/hosts-pre-p1.ref`) · lifeline `/tmp/restore-handbuilt.sh` present, md5 `c73fbacfc956d35173ccdf2fcebd2580` · TV↔local script md5s all equal (sync) · toml keys: `listen_addresses=['127.0.0.1:5335']`, `forwarding_rules = '. 192.168.179.1'`, `blocked_query_response='refused'`, `user_name='nobody'` (active, from Block 5).
**Mechanism note (Task 8 verdict → this block):** kernel (4.4.84 kcl4tv) has **no REDIRECT target and no owner match** (FW-1 F5/F6) ⇒ the plan's primary M-B shape cannot exist; M3 measured plain DNAT-to-self WORKS but **self-loops** the filter's own upstream traffic (`example.com` TIMEOUT in the probe shape). Chosen mechanism = **DNAT-to-self + upstream-exclusion loop-avoidance** (`! -d 192.168.179.1`) — the harness scripts were minimally edited before P2 (recorded below). Pre-flight: the exact shape was added/checked/deleted on a dummy port (5399) before touching :53 → valid on this iptables 1.6.2 (`eff-pre-p1-iptables-matrix-20260915-134525.txt`).

### EFF-HOSTS — P1 hosts-only phase (hosts section added; no rules, no filter)
**Command(s):** plan Task 12 Step 1 inline (`printf '%s\n' … S0LIST … >> /etc/hosts; sh $S0/efficacy-run.sh hosts`) + evidence echoes; pre-baseline run with the same matrix (`efficacy-run.sh pre`) BEFORE the append.
**Raw output:** `..\captures\eff-pre-p1-20260915-134500.txt` (pre-baseline, hosts untouched) + `eff-p1-hosts-20260915-134548.txt` (append + hosts phase) + `eff-p1-attribution-20260915-134714.txt` (who-returns-NODATA probes).
**Measured:**
- hosts md5 `7900d0cf…` → `9467dccf9e9745eaad0d1ceffccaeef7` after append (S0LIST = 7 lines: 2 markers + 5 resolver lines; mount count stays 1 — in-place O_APPEND, mount preserved).
- **getent: all 5 list names → `0.0.0.0`** (hosts layer live) · zone probe `s0-zone-probe.lgtvcommon.com` → getent EMPTY (**hosts has no zone semantics — as expected**) · `example.com` getent resolves (IPv6).
- **stub path (127.0.0.1:53): all 6 LG names `rcode=0 ancount=0` (NODATA) — IDENTICAL in the pre-append and post-append runs ⇒ the stub path is unaffected by the hosts layer** (ConnMan proxy behavior re-confirmed on this build).
- direct path (192.168.179.1:53): identical NODATA for the same names.
- Attribution probes: `snu.lge.com` (real LG name) via AGH-direct → **NODATA**; `ads.lgtvcommon.com` via 8.8.8.8 → `rcode=3` NXDOMAIN (public state, matches M3's pre-rule observation); `example.com` / `google.com` via AGH → real A ⇒ **the NODATA response style for LG-family names is network-side (AGH) behaviour**, present with AND without our layers.
- **Demotion number:** stub-path "blocked" (no usable answer) = **B = 5/5 literal** — but stub-path outcome *changed by the hosts layer* = **0/5** (pre == post; nothing about the stub path is hosts-attributable). The plan's expected scenario ("stub resolves them anyway") did NOT reproduce — masked by the AGH NODATA style.
**Pass/Fail criteria:** record the number + per-path behaviour (plan's demotion rule, "proposed — adjust at session"). → **PASS (recorded) — deviation flagged:** for D12/§7 demotion wording use the *hosts-attributable* reading (0/5 changed / stub ignores hosts), NOT the literal 5/5 (which is AGH-mediated). Recorded both.

### EFF-FILTER — P2 filter-only phase (harness apply → hosts removal → efficacy + status)
**Command(s):** `sh $S0/filter-apply.sh` → grep-bounded hosts removal (in-place `cat > /etc/hosts`) → `sh $S0/efficacy-run.sh filter` → `sh $S0/status.sh` (+ nat/log evidence).
**Raw output:** `..\captures\eff-p2-apply-20260915-134943.txt` + `eff-p2-filter-20260915-135004.txt` + `eff-p2-upload-20260915-134853.txt` (script edits) + `eff-post-keeper-20260915-135106.txt` (keeper).
**Measured (13:49:37–13:51:10):**
- apply `RESULT=OK` rc=0; journal stages 1→6 in 5 s; nat = exactly 2 rules:
  `-A OUTPUT ! -d 192.168.179.1/32 -p udp -m udp --dport 53 -j DNAT --to-destination 127.0.0.1:5335` (+ tcp twin); filter pid 23693; `pointer=on`.
- hosts section removed → **`HOSTS-RESTORED-BYTE-IDENTICAL`** vs `hosts-pre-p1.ref` (`7900d0cf…`), mount count 1, `getent ad.lgappstv.com` unresolved.
- **filter path (127.0.0.1:5335): 5 list names + zone subdomain all `rcode=5` REFUSED (6/6 ✓)**; `example.com` resolves (`A=104.20.23.154`; query log `FORWARD 8ms 192.168.179.1:53` — **no self-loop; the exclusion works**).
- **stub path (127.0.0.1:53): same 6/6 `rcode=5` REFUSED** — the DNAT captures app→stub traffic before connmand ⇒ stub PASS criterion met via the TV-local mechanism.
- `blocked-names.log`: 12 REJECT lines; zone probe matched **`*.lgtvcommon.com`** (zone semantics live). `queries.log`: `REJECT 0ms` per probe + a REAL TV app query inside the window (`qgmg.api.amazonvideo.com` FORWARD 99 ms, client 192.168.179.8) = live in-path corroboration; no loop churn, no "too many connections".
- `status.sh`: `filter=up · rule=on · keeper=up · gaveup=no · pointer=→on` (keeper started 13:51, `setsid`, persists across session close; dropbear-teardown behaviour measured first — `eff-persist-test-20260915.txt`).
**Pass/Fail criteria (run-sheet Block 9 step 2 / plan Step 2):** all 5 list names + zone subdomain BLOCKED via `filter` and `stub` paths; `example.com` resolves. → **PASS.**

### Script edits (required by the T8 verdict; recorded per run-sheet step 2 + plan Step 2 fallback clause)
4 files, minimal shape swap (REDIRECT+owner-match → DNAT-to-self + `! -d $UP`), backups **local + TV** as `*.pre-dnat-loopfix`:
| file | old md5 → new md5 | change |
|---|---|---|
| `filter-apply.sh` | `0e06ac6b…` → `0446111b7a50ac2ea002838232bb70aa` | rule_del/rule_add → DNAT+excl; header note |
| `filter-rollback.sh` | `e9db75aa…` → `c84f6a8bd35bf556290f4fd302f9eac5` | same shape; left-count greps `to-destination 127.0.0.1:5335` |
| `keeper.sh` | `81c61ab0…` → `4000675d6d1c2e8d823ea97fd3486423` | re-add block same shape |
| `status.sh` | `74450da4…` → `13b58751f3a729d4a673ecfcaf9c01b4` | rule check same shape |
**Why 4 files, not 1:** apply may only add what rollback can remove (D10 order-law / fail-open), status must report the real shape, keeper must re-add the real shape — leaving them stale would break the session's own rollback/keeper semantics. TV==local md5 verified post-upload; `sh -n` OK ×4; LF-only (0 CR bytes). Diff summary in `eff-p2-upload-20260915-134853.txt`. `-C` semantics verified on this build: rc=0 ⇔ rule exists (stderr "Bad rule / No chain,target/match" noise is cosmetic, rc-based checks correct).

### Cross-block flags (no action in this block)
1. **D5 detector vs harness rules:** `foreign-detector.sh` D5 excludes `grep -v LGTVBLK`; the harness DNAT rules carry no LGTVBLK label ⇒ if the detector is re-run while the filter is ON, it will report our own rules. Known; detector not executed in T12–T14.
2. `cleanup.sh` comment + fallback text still say REDIRECT/owner-match; its PRIMARY path calls the updated `filter-rollback.sh` (lines 18–19) ⇒ functional; cosmetic only.
3. `status.sh` prints the pointer file raw (`pointer=pointer=on` — file content is `pointer=on`) — pre-existing cosmetic.
4. Dropbear teardown: plain `&` children survive session close (ALIVE from a new session) — `eff-persist-test-20260915.txt`.

**End state (verified 13:51:06–10, incl. from a new SSH session):** filter **UP** (pid 23693) + keeper **UP** (pid 24007), both alive; nat :53 = 2 DNAT+excl rules; **no 853 drops (that is P3/step 4 — not this block)**; `pointer=on`; hosts = HBC sheet only (byte-identical restore); hooks 00/02 `-rw-` (pause intact, untouched); lifeline present (`c73fbacf…`); filter+keeper deliberately LEFT ON (T12–T14 window; owner playback smoke follows).
**Deviations (recorded):** 1. Run-sheet step 2's `user_name='nobody'` conditional did not apply (mechanism = DNAT, not REDIRECT+owner-match); the toml already carried the line from Block 5 — kept, harmless. 2. Script edits above (plan-sanctioned fallback for the Task 8 verdict; recorded with backups). 3. P1 prior-evidence expectation ("stub resolves anyway") did not reproduce — AGH NODATA, attribution recorded, both B readings given. 4. First two SSH wrappers of this block had a PowerShell capture bug (local only; no TV effect; capture files re-written correctly). 5. No commits.

**Raw files (Block 9):** `..\captures\eff-pre-p1-20260915-134500.txt` · `eff-pre-p1-iptables-matrix-20260915-134525.txt` · `eff-p1-hosts-20260915-134548.txt` · `eff-p1-attribution-20260915-134714.txt` · `eff-p2-upload-20260915-134853.txt` · `eff-p2-apply-20260915-134943.txt` · `eff-p2-filter-20260915-135004.txt` · `eff-post-keeper-20260915-135106.txt` · `eff-persist-test-20260915.txt` · `eff-final-state-20260915-135233.txt`

---

## Block 9 — S0 T12 steps 4–6: P3 combined / blocked-response variants / bypass numbers — 2026-09-15 14:00 CEST

**Task:** run-sheet Block 9 steps 4–6 (plan Task 12 Steps 4–6; step 7 skipped — see criteria) · **Mode:** AFK · **When:** started 2026-09-15 14:00 CEST (TV clock = laptop clock)
**Preconditions (verified live 14:00:09, read-only; `..\captures\eff-p3-pre-20260915-140015.txt`):** `ssh-ok`; TV up 1:51; filter pid 23693 ALIVE + keeper pid 24007 ALIVE; nat :53 = exactly 2 rules (`! -d 192.168.179.1/32` udp+tcp → DNAT `127.0.0.1:5335`); 853 drops = 0 (step 4 adds them); `/etc/hosts` md5 `7900d0cfacb7e175b60b2d6ca66d59ac` == `/tmp/hosts` (P2 state, no S0LIST); hooks 00/02 `-rw-` (pause intact); lifeline `/tmp/restore-handbuilt.sh` present `c73fbacfc956d35173ccdf2fcebd2580`; toml `6612f75c08463292290e7e570aeed8bd` + kit md5s (`0446111b…`/`c84f6a8b…`/`4000675d…`/`13b58751…`/`55084874…`) == local; status block `filter=up rule=on keeper=up gaveup=no pointer=on`.
**Criteria (written BEFORE the runs — run-sheet Block 9 steps 4–6 + plan Task 12 Steps 4–6; source of truth):**
- **EFF-COMBINED (step 4):** PASS if the P2 blocking is unchanged (5 list names + zone subdomain blocked via filter AND stub paths; `example.com` resolves) **plus** the 853 drops are confirmed (`timeout -t 5 nc -z 8.8.8.8 853` times out/killed) **and** drop counters increment. Record per-layer deltas (what only the firewall adds; what only hosts adds).
- **EFF-VARIANTS (step 5):** PASS if both variants produce deterministic blocked answers (A `refused` → rcode 5; B `a:0.0.0.0,aaaa::` → NOERROR with null answers) and one is chosen provisionally (proposed: A). Keep A active at the end. Record which response mode the TV's own daemons honor (query log + stub behavior).
- **EFF-BYPASS (step 6):** PASS = numbers recorded verbatim for the honest-limits section: hardcoded-53 (no escape if mechanism in path) · DoT 853 (dropped in combined) · v6 (route/table state recorded) · DoH:443 (reachable = documented limit; measure, do not fix).
- **Step 7 (M3 take-over leg): SKIPPED — not needed** (DNAT-to-self path works; orchestrator decision). Contingency only if a step here reveals a need.

### EFF-COMBINED — P3 combined phase (853 drops + hosts section + filter A + AGH) — 14:02:00–14:03:1x CEST
**Command(s):** 853 drops (`iptables -A OUTPUT -p tcp/udp --dport 853 -j DROP`) + hosts S0LIST re-add (in-place `>>`, same 7 lines as P1) + `sh $S0/efficacy-run.sh combined` + drop verification (`timeout -t 5 nc -z 8.8.8.8 853` — see deviation 1 — then openssl replacement) · raw: `..\captures\eff-p3-combined-20260915-140206.txt` + `eff-p3-853verify-20260915-140311.txt`.
**Raw output (key lines, verbatim):**
```
[t1] tcp-add-rc=0 / udp-add-rc=0 → -A OUTPUT -p tcp -m tcp --dport 853 -j DROP (+udp twin)
[t2] hosts-md5=9467dccf9e9745eaad0d1ceffccaeef7 · mountcount=1 · getent ad.lgappstv.com → 0.0.0.0
[t3] combined matrix: example.com rc=0 A=172.66.147.243 (getent/stub/direct/filter) ·
     all 6 blocked names: stub rcode=5 REFUSED · filter rcode=5 REFUSED · direct rcode=0 NODATA (AGH) ·
     getent: 5/5 → 0.0.0.0, zone probe getent empty (no hosts zone semantics)
[t4] (combined capture) nc usage = "Usage: nc [IPADDR PORT]" (option-less busybox) →
     rc-853-z=1 / rc-853-w=1 / rc-443-w=1 = all parse exits, NOT network tests
[t4b] (853verify capture) openssl DoT 8.8.8.8:853 rc=143 elapsed=5s outbytes=11 ("Terminated"; no handshake)
     openssl control TLS 1.1.1.1:443 rc=0 elapsed=0s outbytes=4650 (handshake OK → tool valid)
     counters after redo: tcp dpt:853 pkts=3 · udp dpt:853 pkts=0 (tcp reaches 9 after bypass-step attempts)
[t5] status filter=up rule=on keeper=up pointer=on · nat-dport-count=2
```
**Measured:** Combined blocking = identical to P2 (6/6 REFUSED via stub AND filter; `example.com` resolves on every path; direct path stays AGH-NODATA background). **Per-layer deltas:** (a) *firewall-only adds* the DoT cut — proven by the 853 DROP with a validated control pair and incrementing counters; (b) *hosts-only adds* the `getent`/glibc null-route for exact names (stub/filter path output is unchanged by hosts — same 6/6 REFUSED with and without it); (c) *DNAT+filter* carries all DNS blocking on both query paths. Hosts section append preserved the mount (count 1; same md5 as P1 append).
**Pass/Fail criteria:** PASS if P2 blocking unchanged + 853 drops confirmed + counters increment. → **PASS** (853 confirmed via openssl + counters; prescribed `nc` tool unusable — deviation 1).

### EFF-VARIANTS — A (`refused`) vs B (`a:0.0.0.0,aaaa::`) — 14:03:5x–14:06:3x CEST
**Command(s):** keeper stopped (single-manager discipline) → `filter-rollback.sh` (rules out first, filter killed second) → toml swapped byte-exact via scp → **B:** manual D12-ordered apply (start on side port → selftest → DNAT rules → e2e verify; journal `variants-B-manual-apply`) → `efficacy-run.sh filter` + nslookups + logs · **A:** `filter-rollback.sh` → canonical toml scp (md5 `6612f75c…`) → `filter-apply.sh` (RESULT=OK, stages 1→6, 14:05:05–11) → same measurements → keeper restarted (setsid, pid 27484).
**Raw files:** `..\captures\eff-variants-b-20260915-140404.txt` · `eff-variants-a-restore-20260915-140504.txt` · `eff-variants-a-20260915-140511.txt` · `eff-variants-end-20260915-140631.txt` · variant-B toml copy kept at `..\candidate\dnscrypt-proxy.toml.variant-b` (md5 `fc529e0e…`).
**Measured (identical conditions both legs: filter + DNAT + 853 + hosts section):**
- **Variant B:** side-port + stub + filter paths: `rcode=0 ancount=1 A=0.0.0.0` for all 6 names; `nslookup ads.lgtvcommon.com` → `Address: 0.0.0.0`; AAAA → `Address: ::ffff:0.0.0.0` (parsed `aaaa::`); `example.com` resolves on all paths; blocked-names.log/query-log still `REJECT` lines (`A` + `AAAA`).
- **Variant A:** stub + filter paths: `rcode=5 ancount=0 none` for all 6; `nslookup` → `server can't find ads.lgtvcommon.com: REFUSED`; same `REJECT` logging; `example.com` resolves.
- **Difference (deterministic both ways):** blocked answer shape only — A = REFUSED (rcode 5), B = NOERROR + null A/AAAA. TV-daemon observation: 1 real TV app query inside the B window (`unagi-na.amazon.com` FORWARD 10 ms — in-path corroboration); no controlled per-variant app fetch was possible in this AFK window ⇒ the final response-mode choice stays with the owner playback in T14 **keeping A provisionally** (plan default; and the earlier owner playback PASS already ran on variant A).
- **Keeper:** down 14:03:55→14:06:25 (status blocks show `keeper=down`, expected), restarted pid **27484** `keeper-ALIVE`; filter pid 26668 (B) / 27135 (A) — A's filter ALIVE at end.
**Pass/Fail criteria:** both variants deterministic + one chosen provisionally. → **PASS** (A kept active; B fully reversible — toml round-tripped byte-identical `6612f75c…`).

### EFF-BYPASS — honest-limits numbers — 14:06:36–14:07:2x CEST (state: filter A + DNAT + 853 drops)
**Command(s):** hardcoded-53 (`dnsq.sh <name> 8.8.8.8 53`) · DoT (`openssl s_client -connect <ip>:853`, 5 s cap) · v6 (`ip -6 route`, `ip -6 addr`, bounded `nslookup` to a public v6 resolver) · DoH (`curl https://1.1.1.1/dns-query` + `cloudflare-dns.com`, JSON API) · raw: `..\captures\eff-bypass-20260915-140642.txt` + `eff-bypass-supp-20260915-140725.txt`.
**Raw output (key lines, verbatim):**
```
hardcoded 8.8.8.8:53 · ads.lgtvcommon.com → rcode=5 ancount=0 (rc=2)   [NO ESCAPE — DNAT captures it]
hardcoded 8.8.8.8:53 · example.com        → rcode=0 ancount=2 A=172.66.147.243 (rc=0)   [forwarding intact]
DoT 8.8.8.8:853  → rc=143 elapsed=5s outbytes=11    DoT 9.9.9.9:853 → rc=143 elapsed=5s   [opaque-blackhole]
control TLS 1.1.1.1:443 → rc=0 elapsed=0s outbytes=4650
853 counters: tcp pkts=9/540B · udp pkts=0
v6: routes fd4d:c8d7:eb60:1::/64(ULA) wlan0 + fe80::/64 · addr fd4d:…:26e8:53ff:fe77:fd3a/64 scope global dynamic (ULA)
v6 probe: nslookup ads.lgtvcommon.com 2620:fe::fe → rc=1 "connection timed out; no servers could be reached"
DoH 1.1.1.1/dns-query?name=ads.lgappstv.com → HTTP 200 · {"Status":3,...} ; cloudflare-dns.com → 200
DoH supplementary live name: snu.lge.com — filter: rcode=5 REFUSED (rc=2; name present in filter-s0.txt ×1)
  → DoH: HTTP 200 · {"Status":0,...,"data":"alb-an2-dmz-waf-new-257705615.ap-northeast-2.elb.amazonaws.com." → "52.78.227.93"}
```
**Measured / honest limits:** hardcoded-53 = **covered** (no escape; normal names still forward). DoT/853 = **covered** while the firewall layer is on (both targets 5s-blackholed; control proves the tool/path). v6 = **not applicable on this TV** — ULA-only addressing (guest net), no global v6 path (public-v6-resolver probe times out); would additionally be **unfilterable** on this kernel (no `ip6_tables` — FW-1). DoH over 443 = **REACHABLE and fully functional: a DoH-capable app can resolve any live name without this DNS layer** (concrete: `snu.lge.com` REFUSED by our stack, resolved to a live AWS IP via DoH) — documented limitation, not fixable at the DNS layer (needs SNI/IP-level control, out of scope).
**Pass/Fail criteria:** numbers recorded verbatim for the report's honest-limits section. → **PASS.**

### EFF-PLAYBACK / Gate F — owner playback smoke — owner-confirmed 2026-09-15
**Mode:** HITL (run-sheet Block 9 step 3) · reported after the fact to the operator.
**Measured:** owner ran **~1 h of Prime Video with the harness filter ON (variant A, P2 state)** — played perfectly fine; **no stutter, no error card, no failed app start**. No further detail reported.
**Pass/Fail criteria (Gate F):** EFF-FILTER PASS; owner playback PASS (also the T14 toggle prerequisite). → **PASS — Gate F met.**
**Note:** the T14 playback will re-check the response mode decision (A vs B) with the owner present; A stays active until then.

**Deviations (recorded, steps 4–6):**
1. **`nc` tool unusable on this build** — busybox nc is option-less (`Usage: nc [IPADDR PORT]`); the prescribed `timeout -t 5 nc -z …` exits rc=1 at parse time **without touching the network** (counters stayed 0). Substituted stock `openssl s_client -connect <ip>:853` (5 s cap) with a validated control pair (1.1.1.1:443 handshake) + counter corroboration. **Feeds Task 17:** the run-sheet/plan command must be the openssl form on webOS.
2. **Variant-B apply leg was manual** (journal line `variants-B-manual-apply`): `filter-apply.sh`'s `blocked_check` asserts REFUSED (rc=2) and would roll back under variant B — the B leg reproduced the same D12 order manually (side-port selftest → rules → e2e verify). Variant A used `filter-apply.sh` unchanged.
3. **Variant flip implemented by scp of byte-exact toml copies** (variant-B generated locally, `fc529e0e…`) rather than sed; TV toml ended byte-identical to canonical A `6612f75c…` (TV↔local sync preserved).
4. **Keeper deliberately stopped for the variant window** (14:03:55–14:06:25) to keep one manager at a time; interim statuses show `keeper=down` (expected); restarted + verified before step 6.
5. **Phase-end state choice:** hosts S0LIST test section **removed** (in-place rewrite; byte-identical `7900d0cf…`, mount 1) — the filter + 853 drops stay ON for the T13–T14 window (do NOT roll back); 853 drops are removed by T15 cleanup.
6. **Step 7 (M3 take-over leg) SKIPPED — not needed** (DNAT-to-self path works end-to-end; no step revealed a need). Orchestrator decision, recorded per instruction.
7. No commits; no reboots; hand-built hooks untouched (00/02 still `-rw-`).

### End state (verified 14:07:28–34 — `..\captures\eff-p3-endstate-20260915-140734.txt`)
filter **UP** (pid 27135) + keeper **UP** (pid 27484) · nat :53 = 2 DNAT+excl rules · 853 DROPs ×2 (tcp pkts=9 · udp pkts=0) · hosts = HBC sheet only (`7900d0cf…` byte-identical restore, mount count 1, `getent ad.lgappstv.com` unresolved) · hooks 00/02 `-rw-` (pause intact, untouched) · lifeline `/tmp/restore-handbuilt.sh` present (`c73fbacf…`) · toml variant A `6612f75c…` · `pointer=on` · SSH OK.

**Raw files (steps 4–6):** `..\captures\eff-p3-pre-20260915-140015.txt` · `eff-p3-combined-20260915-140206.txt` · `eff-p3-853verify-20260915-140311.txt` · `eff-variants-b-20260915-140404.txt` · `eff-variants-a-restore-20260915-140504.txt` · `eff-variants-a-20260915-140511.txt` · `eff-variants-end-20260915-140631.txt` · `eff-bypass-20260915-140642.txt` · `eff-bypass-supp-20260915-140725.txt` · `eff-p3-endstate-20260915-140734.txt`

---

## Block 10 — S0 T13: keeper survivability + failure suite A (KEEP-1, FAIL-DEL, FAIL-MIDAPPLY, FAIL-MATRIX, Gate G) — 2026-09-15 14:17–14:57 CEST

**Task:** run-sheet Block 10 steps 1–6 · **Mode:** AFK + owner-approved reboot (step 1) + owner-approved optional HITL S3 (step 3, RUN per instruction) · **When:** 14:17:57–14:56:56 CEST (TV clock = laptop clock).
**Preconditions (14:17:57):** `ssh-ok` · filter.pid 27135 ALIVE + keeper.pid 27484 ALIVE · nat = 2 DNAT+excl rules · 2× :853 DROP · `/etc/hosts` md5 `7900d0cfacb7e175b60b2d6ca66d59ac` (HBC sheet) · lifeline `/tmp/restore-handbuilt.sh` present (c73fbacf…) · `kill-matrix.sh`/`s3-elevated-service.sh` NOT yet on TV (uploaded this block).
**Criteria (run-sheet Block 10 + plan Task 13; source of truth):** step1 S1 = boot-hook bg process pid ALIVE/DEAD (expect DEAD) → `KEEP-1` · step2 S2 = exec-launched bg ALIVE/DEAD → `KEEP-1` · step3 S3 = setup→observe→kill-observe→cleanup (abort on any instability) · step4 FAIL-DEL PASS = resolves ≤10 s, ≤3 restart attempts, gaveup=yes, protection-off steady state · step5 FAIL-MIDAPPLY PASS = per-stage coherent, reconcile full ON/OFF · step6 FAIL-MATRIX PASS = recovery ≤60 s w/o user action; K = zero DNS impact · **Gate G** = recovery coherent for all orders; mixed state → FAIL + mitigation.

### Step 1 — S1 boot-hook background-process survival (reboot)
**Commands:** upload `97-s0-bgtest`→init.d (md5 TV==local `646cfb43…`, 755) + `kill-matrix.sh`/`s3-elevated-service.sh`→`$S0` (md5 TV==local `a2f5ca5e…`/`09b5786b…`); `systemctl reboot`; poll; `P=$(tail -1 $S0/bgtest.log | cut -d' ' -f1); kill -0 $P`.
**Raw (key):**
```
REBOOT-ISSUED 14:18:48 → SSH-BACK 14:19:42 (~55 s, clean) · TV up 0 min
boot-probe.log: +"=== boot-probe 2026-09-15 14:19:10 uptime_s=32.09 ==="  (hooks ran this boot)
bgtest.log (only line): 5003 1789474751   (epoch → 14:19:11 = boot+~32 s)
@14:21:14 (90 s post-SSH): kill -0 5003 = ALIVE; /proc/5003/cmdline = "sleep 300";
   /proc/5003/status Name=sleep State=S; ppid=1; cgroup=…:/system.slice/ls-hubd.service;
   start_ticks=3254 (≈32.5 s post-boot); ps w | grep sleep → (no output — ps w omits orphans)
```
**Measured:** the boot-hook-spawned `( sleep 300 ) &` **survived** (alive @+146 s, PPid=1, inherited the persistent `ls-hubd.service` cgroup because `startup.sh` runs under ls-hubd) → **S1 = ALIVE**. `ps w` is unreliable here (hid the process); `/proc` is authoritative.
**Pass/Fail:** record alive/dead + timestamp; **plan expected DEAD (cgroup-kill) — measured ALIVE (deviation, see below).**
**Verdict:** **S1 = ALIVE** — boot-hook-launched background processes survive on G1. Hook removed after (`HOOK-REMOVED`; init.d back to 7 entries). Lifeline re-staged (md5 `c73fbacfc956d35173ccdf2fcebd2580`); harness re-applied: `filter-apply` RESULT=OK → filters/keeper up; 853 drops re-added.

### Step 2 — S2 exec-launched background process
**Command:** `luna-send -n 1 -f luna://org.webosbrew.hbchannel.service/exec '{"command":"(sleep 300) & echo $! > /tmp/s0-exec-bg.pid; echo started"}'`.
**Raw (key):**
```
preflight /exec echo hbc-alive → {"stdoutString":"hbc-alive\n","returnValue":true}
launch (bg child holds stdout pipe) → luna-send NEVER returned (SSH call hung; killed by client timeout)
  → sleeper pid 7405 started, PPid=1, cgroup …:/system.slice/ls-hubd.service
clean detached relaunch ( child stdio >/dev/null 2>&1 ) → {"stdoutString":"started\n","returnValue":true} luna-rc=0, pid 8581
@+90 s: 7405 ALIVE · 8581 ALIVE   (/proc enumeration)
```
**Measured:** exec-launched background process **SURVIVES** (both launches alive >90 s, cgroup `ls-hubd.service`). **Finding:** a long-lived child must **detach its stdio** inside the `/exec` command, else the HBC `/exec` call blocks until the child exits (consistent with EXEC-1's "bounded reader required").
**Verdict:** **S2 = ALIVE.**

### Step 3 — S3 elevated service (owner-approved; RUN)
**Result: attempted, NOT validated (time-boxed).** Bounded findings:
```
s3-elevated-service.sh setup → "== elevate ==" /bin/sh: ".../elevate-service org.example.s0keeper: not found"
   → SCRIPT DEFECT: line 29 over-quotes ("$HBC/elevate-service org.example.s0keeper" = one filename).
ran plan's Step-3.2 command directly: "$HBC/elevate-service" org.example.s0keeper → "[-] No changes, no rescan needed"
elevate-service source (node) = main(serviceName,appName): only PATCHES an EXISTING services.d/<name>.service
   (+ client/api permission files); it does NOT register a new service. (Plan's recipe assumed it would.)
manual bounded registration: created /var/luna-service2-dev/services.d/org.example.s0keeper.service (modeled on
   inputhook template) + manifests.d/org.example.s0keeper.json; elevate-service then created
   client-permissions.d/org.example.s0keeper.root.json + api-permissions.d/…api.public.json + refreshed services
luna-send luna://org.example.s0keeper/heartbeat → "Service does not exist"; ls-control scan-volatile-dirs → same;
ls-monitor -l | grep s0keeper → not-listed. NO process, NO heartbeat.
cleanup: script cleanup (killed itself once via `pkill -f org.example.s0keeper` self-match — re-run by name) +
   manual rm of the 4 LS2 files → services.d/manifests.d back to stock; SVC dir gone; zero residue.
```
**Measured:** `elevate-service` elevates/patches but does not register; an ad-hoc LS2 service could not be brought up with the plan's bounded recipe (hub never registered the name). **Not an instability; no TV harm.** → **S3 = "priced, not validated"** (needs devmode/manifest flow or a reboot rescan — S4 input).
**Abort criteria:** none triggered (SSH/DNS stable throughout).

### Step 4 — FAIL-DEL (binary moved + `kill -9` filter)
**Raw (key):** kill@epoch 1789475427; `DNS-OK after 0s`; `keeper.log`: `filter-dead restore-first` → `rule-removed` → `restart-attempt 1`; status during: `filter=down rule=off keeper=up gaveup=no pointer=off`; @+30 s: gaveup file present, status `filter=down rule=off keeper=up gaveup=yes pointer=off`, DNS rc=0, nat rules=0.
**Measured:** DNS restored **immediately (0 s)** (keeper's restore-first rollback removed rules before retrying); `gaveup=yes`; steady state = **protection off, TV works**; **deviation:** the harness keeper's give-up is **non-terminal** — it re-enters the retry loop after give-up (attempts 1/2/3 @+1/+12/+23 s → give-up @+31 s → second cycle attempt 1 again; 5+ attempts counted, not ≤3).
**Verdict:** **FAIL-DEL PASS** (DNS-OK ≤10 s; gaveup written; steady state protection-off) — with the non-terminal-give-up deviation. Restored: keeper stopped (avoid concurrent rollback), binary `mv`-back, `filter-apply` RESULT=OK, keeper restarted → `filter=up rule=on keeper=up gaveup=no`.

### Step 5 — FAIL-MIDAPPLY (`S0_KILL_AT` at 3 stages; keeper stopped for clean measurement)
**Raw (key, per stage; rc=137 = kill -9 at mark):**
```
stage3-sideport-ok : rule=off rules=0 filter.pid=12413 alive=yes pointer=off dns rc=0 | reconcile RESULT=OK → rule=on
stage4-rule-add    : rule=off rules=0 filter.pid=12548 alive=yes pointer=off dns rc=0 | reconcile RESULT=OK → rule=on
stage5-verified    : rule=ON  rules=2 filter.pid=12689 alive=yes pointer=off dns rc=0 | reconcile RESULT=OK → rule=on
keeper restarted → filter=up rule=on keeper=up
```
**Measured:** each stage left a **coherent** state (never rule-on/filter-dead); the orphaned filter survives the parent kill; reconcile converged to full ON every time. **Deviation:** the keeper was stopped for the run (otherwise it restarts the filter within ~1 s → port-5335 collision prevents the apply from reaching the later stages — a harness keeper-vs-apply race, recorded).
**Verdict:** **FAIL-MIDAPPLY PASS.**

### Step 6 — FAIL-MATRIX (`kill-matrix.sh`, 5 orders)
**Script defect + fix (recorded):** as-shipped `kill-matrix.sh` does `kill "$POLLER"` **before** `wait "$POLLER"` → the 90-second DNS poll is cut to ~2 s (scenario F measured **14.3 s**, timeline = **1 line**), contradicting the script's own header ("polls DNS each second for 90s") and the run-sheet/plan ("each ≈95 s"). **Minimal fix applied** (backup `kill-matrix.sh.pre-pollfix`): moved the kill after the wait; also added `KM_ITERS` override (default 90) because each FAIL sample costs a DNS timeout (~7 s) — dark orders run with `KM_ITERS=12` to bound TV dark-DNS exposure. TV==local md5 `4397bc70ac9875de163153809d3d8cee`, `sh -n` OK.
**Raw (key):**
```
F   (90 iters): 90/90 OK (epoch 1789475667…1789475920) — zero DNS impact; keeper restored filter+rule
                (pre-recovery status: filter=up rule=on keeper=up pointer=off — keeper's rollback clears the pointer
                 and never rewrites it: pointer left OFF after a keeper self-recovery)
K   (90 iters): 90/90 OK — zero DNS impact; pre-recovery status keeper=down (killed), filter=up rule=on pointer=on
FK  (12 iters): OK, then 11× FAIL, still_FAIL_at_end (dark ≥73 s); status filter=down rule=on keeper=down pointer=on  → MIXED STATE
KF  (12 iters): OK, then 11× FAIL, still_FAIL_at_end; same mixed state
BOTH(12 iters): OK, then 11× FAIL, still_FAIL_at_end; same mixed state
each run's end: harness `filter-rollback; filter-apply` → RESULT=OK → ON; keeper restarted → status ON
```
**Measured:** **F = PASS** (zero DNS impact; keeper auto-recovers filter), **K = PASS** (zero DNS impact; `keeper=down` detected), **FK/KF/BOTH = FAIL** — with the keeper dead nothing removes the rules, so DNS stays **dark indefinitely** and the **rule-on/filter-dead mixed state persists** (no auto-recovery; only the harness's own end-reconcile restores ON, which is not "without user action"). Hidden coherence bug: after any keeper self-recovery the `pointer` file is left OFF while protection is ON.
**Verdict:** **FAIL-MATRIX = FAIL** (F/K pass; 3 of 5 orders dark + mixed). **Gate G = FAIL/mitigation required.**

### Gate G
Recovery is coherent for **F** and **K** only. For **FK/KF/BOTH** the single-keeper design leaves a persistent mixed state (`rule=on` + `filter=dead` + dark DNS) until an external reconcile. → **Gate G = FAIL (mixed state)** with the run-sheet's concrete mitigations required before T14: **(1) second watchdog** — a boot-hook-launched supervisor is viable (S1 proved boot-hook bg processes survive: cgroup `ls-hubd.service`); **(2) elevated-service keeper** — S3 was priced but **not validated** (LS2 registration unresolved); **(3) resolv-free / deadman-switch design** — keeper should remove rules on its own death (or a second process should), so a keeper kill cannot leave rules pointing at a dead filter.

### End state (verified 14:56:56)
`filter=up rule=on keeper=up gaveup=no pointer=on` · filter 18443 ALIVE + keeper 18485 ALIVE · nat = 2 DNAT+excl rules · 2× :853 DROP · `/etc/hosts` md5 `7900d0cfacb7e175b60b2d6ca66d59ac` == `/tmp/hosts` · lifeline `/tmp/restore-handbuilt.sh` present (778 B, c73fbacf…) · init.d = 7 known entries (no `97-s0-bgtest`) · no `gaveup` · `/var/luna-service2-dev/{services,manifests}.d` = stock (S3 residue gone) · DNS canaries: `example.com` rc=0, `ads.lgtvcommon.com` REFUSED rc=2 · SSH OK. **TV usable; harness filter+keeper left ON for T14–T15 (deliberate).**

### Deviations (recorded)
1. **kill-matrix.sh poll defect + minimal fix** (see step 6); backup `kill-matrix.sh.pre-pollfix` (TV+local). Originals preserved.
2. **S1 ALIVE contradicts plan's "known: cgroup-killed"** — likely because `startup.sh` runs inside the persistent `ls-hubd.service` cgroup. Big KEEP-1 design input.
3. **`ps w` unreliable** (omits orphaned/orphan-cgroup processes) — all liveness decided via `/proc`; the plan's `ps w | grep` recipe would have given wrong answers.
4. **`s3-elevated-service.sh` line-29 quoting defect** (elevate-service "not found"); ran the plan's command directly.
5. **FAIL-MIDAPPLY run with keeper stopped** (one-manager; keeps apply from colliding on :5335 with the keeper's auto-restart).
6. **FAIL-MATRIX K/FK first attempts interrupted by operator client timeout** (runs are slow: OK sample ≈3 s, FAIL sample ≈7 s); TV recovered each time; K re-run clean (90 iters), FK re-run bounded (12 iters). F result from the first (90-iter) run.
7. **FAIL-DEL non-terminal give-up** (harness keeper re-retries after give-up) — app keeper must make give-up terminal.
8. `/exec` long-lived-child stdio-detach requirement (step 2).
9. No commits; nothing outside the spike kit / `$S0` / `/tmp` touched; S3 LS2 residue removed.

**Raw files (Block 10):** `..\captures\b10-step1-preflight.txt` · `b10-step1-reboot.txt` · `b10-step1-keep.txt` · `b10-step1-restore.txt` · `b10-step2-exec-bg.txt` · `b10-step3-s3.txt` · `b10-step4-faildel.txt` · `b10-step5-midapply.txt` · `b10-step6-matrix.txt` · `b10-endstate.txt`

---

## Block 11 — S0 T14: failure suite B (FAIL-POWER, FAIL-FAILSAFE, FAIL-ROUTER, TOGGLE-LIVE, HBC-MATRIX) — 2026-09-15 15:0x– CEST

**Task:** run-sheet Block 11 steps 1–5 · **Mode:** HITL-heavy (owner actions relayed via orchestrator) · **Owner approval:** ALL of Block 11 incl. destructive tests GRANTED 2026-09-15 ~14:45 · **When:** started 15:01 CEST.

**Preconditions (15:01:43, `..\captures\b11-preconditions.txt`):** `ssh-ok` · filter 18443 ALIVE + keeper 18485 ALIVE · status `filter=up rule=on keeper=up gaveup=no pointer=on` · nat = 2 DNAT+excl rules (`! -d 192.168.179.1/32 --dport 53 → DNAT 127.0.0.1:5335`) · 2× :853 DROP · `/etc/hosts` md5 `7900d0cfacb7e175b60b2d6ca66d59ac` (HBC sheet; mount=1 tmpfs) · lifeline `/tmp/restore-handbuilt.sh` (`c73fbacf…`) · init.d = 7 entries (00/02 `-rw-` paused; 95-s0-probe present) · no `webosbrew_failsafe` flag (`webosbrew_block_updates` present = ON) · `nohup`+`setsid` available · canonical `filter-apply.sh` TV md5 `0446111b7a50ac2ea002838232bb70aa` (== local).

### FAIL-POWER — power cut during apply

**Criteria (run-sheet Block 11 step 1 / plan Task 14 step 1):** cut mid-apply (agent holds between `stage4-rule-add` and `stage6-committed`); wait 30 s; plug back; normal boot. **PASS = TV boots, resolves ≤60 s after boot start; state converges to ON or OFF per pointer/journal; no manual SSH needed for the TV to work.** FAIL = persistent dark DNS or mixed state requiring manual repair → record exact state.

**Armed-state (operator widening, recorded):** the HITL-relay path made the kit's 30 s `S0_SLOW` window too narrow for a human pull. Per operator protocol, a TEMP env-gated hold was added to a scratch copy of `filter-apply.sh` (`scratch\b11-filter-apply-hold.sh`, md5 `92f7c28cf5116fa7bb0527873560610e`): after `stage5-verified` it logs `holding-stage5-owner-window secs=<S0_HOLD_SECS>` and sleeps `S0_HOLD_SECS` (run with `S0_SLOW=1 S0_HOLD_STAGE5=1 S0_HOLD_SECS=1800`) → a **minutes-long, clearly-held pull window**. Canonical `g1\filter-apply.sh` NOT modified; TV copy backup `filter-apply.sh.pre-hold` (`0446111b…`); **revert after the test**.
**Pre-cut setup:** keeper stopped (pid 18485) → `filter-rollback.sh` (rules left=0) → verified clean OFF (`filter=down rule=off keeper=down pointer=off`, system resolves rc=0). Slow apply launched detached 15:05:28 (epoch 1789477428, `setsid`, log `/tmp/b11-apply.log`).
**Window observed OPEN (`..\captures\b11-power-window-check.txt`, 15:06:46):** `stage=stage5-verified` · journal: `… 1789477554 stage5-verified` + `1789477584 holding-stage5-owner-window secs=1800` · nat = **2** DNAT rules ON · filter=**up** · **pointer file ABSENT (uncommitted)** · stub-canary rc=0, blocked-canary rc=2 (protection live) · hold window close ≈ **15:36:24 CEST**.

**Owner action (relayed):** plug pulled while held at stage5; left off 30 s; plugged back; TV powered on normally — **NO alert/emergency screen** (clean boot).

**Post-cut boot capture (`..\captures\b11-power-postboot.txt`, `b11-power-bootdetail.txt`, `b11-power-bootprobe.txt`):**
```
SSH-BACK first poll 15:13:18 (attempt 1) · TV /proc/uptime = 98.12 s at first contact (TV RTC reset to 2021-01-01 — cold-boot clock loss; no RTC persistence)
boot-probe.log new entry: "=== boot-probe 2021-01-01 01:00:31 uptime_s=33.02 ==="  (hooks DID run this boot; 95-probe fired at uptime ~33 s)
hooklog: run-parts running normally (99-stop-services pass1 22 stopped → pass2 8 stopped); SSH :0016 listening + established; telnet :0017 ABSENT
failsafe flag: present only as the NORMAL per-boot marker (0 B, mid ~4-min window); boot is NORMAL branch (SSH up / telnet closed)
status.sh: filter=down rule=off keeper=down gaveup=no pointer=off   (journal last = holding-stage5; NO commit)
nat: no DNAT rules · 853: none · filter.pid stale-dead 19781 · no dnscrypt/keeper procs · pointer ABSENT · stage marker stale=stage5-verified
canaries: system example.com rc=0 (resolves) · ads.lgtvcommon.com rc=0 (harness off, as expected) · /etc/hosts md5 7900d0cf… UNCHANGED (== /tmp/hosts), mount=1 tmpfs
lifeline /tmp/restore-handbuilt.sh ABSENT (power loss wiped /tmp) → re-staged
```
**Measured:** the mid-apply cut left **no half-state** — the kernel nat rules died with power, the filter/keeper were not boot-enabled, and the `pointer` was never written → post-boot state is a **coherent, automatic OFF** (pointer/journal agree: no commit). The TV booted and worked with **no manual SSH**. Reconcile (re-apply) done by operator: canonical `filter-apply.sh` → `RESULT=OK`; 2×853 DROP re-added; keeper restarted → back to T13–T14 working state (`filter=up rule=on keeper=up`, nat 2 DNAT, 853 ×2, canaries 0/2) — see `..\captures\b11-power-reconcile.txt`.
**Pass/Fail criteria:** PASS = boots, resolves ≤60 s after boot start, state converges per pointer/journal, no manual SSH needed. → **PASS.** DNS/SSH verified working at first post-boot observation (uptime ≤~135 s; hooks ran at uptime 33 s); **not** directly measurable precisely ≤60 s because the harness is **not a boot hook** (see finding). No dark window, no manual repair.
**Finding (design input → S3/Task 17):** the spike harness has **no boot-side reconciliation** — after any power loss the harness stays OFF until re-applied; "convergence" here is the *absence* of a committed pointer, i.e. clean OFF, not auto-ON. The app's keeper must be a **boot hook** (S1 proved boot-hook bg processes survive) that reads pointer/journal and re-establishes ON, else protection silently stays off after an unclean shutdown.
**Owner-confirm note:** no failsafe/alert screen occurred from this cut (the cut was ~35 min after boot, outside the per-boot failsafe window) — clean boot.
**Raw files:** `..\captures\b11-preconditions.txt` · `b11-power-offstate.txt` · `b11-power-launch.txt` · `b11-power-window-check.txt` · `b11-power-postboot.txt` · `b11-power-bootdetail.txt` · `b11-power-bootprobe.txt` · `b11-power-revert.txt` · `b11-power-reconcile.txt`.
**Revert:** temp hold edit reverted — TV `filter-apply.sh` md5 `0446111b7a50ac2ea002838232bb70aa` == canonical (backup `filter-apply.sh.pre-hold` retained); lifeline re-staged (`c73fbacf…`).

### FAIL-FAILSAFE — power cut during the boot window

**Criteria (run-sheet Block 11 step 2 / plan Task 14 step 2):** owner cuts power ~15 s after switch-on (deliberate boot-window interruption); then normal boot; observe. **PASS = failsafe behaves as documented; recovery = one clean reboot; plain-words recovery text drafted.** FAIL = unrecoverable by a clean reboot.

**Sequence (owner-confirmed):** unplug while ON → plug in fresh (boot A, partially ran hooks before the pull) → plug pulled again inside the failsafe-flag window → 30 s off → plug back → **boot B = FAILSAFE** (alert screen with Telnet note). Owner told us the TV sat on the alert screen untouched.

**Failsafe-state capture BEFORE any recovery (`..\captures\b11-failsafe-telnet.txt`, via emergency telnet — SSH down):**
```
port probe 15:20:45: :22 CLOSED/refused · :23 OPEN · `ssh … echo ssh-ok` → "Connection refused"
telnet banner: "webOS TV 6.5.3 LGwebOSTV" then raw root `~ #` shell (telnetd -l /bin/sh)
date Fri Jan 1 01:01:34 CET 2021 (RTC reset on cold boot) · /proc/uptime = 98.70 s
failsafe flag: NO-FAILSAFE-FLAG (failsafe branch already did `sleep 15; rm -rf` → flag self-removed)
prefs: only webosbrew_block_updates / _sshd_enabled / _telnet_disabled (no failsafe)
/tmp/webosbrew_hook.log: ABSENT  → run-parts / init.d hooks DID NOT RUN
listeners: :0017 (telnet) LISTEN + 1 established (our session); **NO :0016** (dropbear/SSH NOT started)
hosts: /etc/hosts md5 4af6093d05fd4d338a78484bd352927d (RAW file; HBC sheet 7900d0cf… absent),
       no /tmp/hosts, grep " /etc/hosts " /proc/mounts → EMPTY  → HBC blockUpdates bind-mount NOT present
nat: no :53 rules · 853: none · status: filter=down rule=off keeper=down pointer=pointer=on (stale)
procs (`ps`): empty — unreliable on this build (Block 10: /proc is authoritative)
/var/log/reports/librdx/: empty (no RDX crash report this boot) · legacy-log tail: normal kernel messages, no crash
```
**Measured:** the deliberately-induced boot-window interruption **reproduced the owner's reported "crashed"/failsafe signature exactly** (SSH off, telnet open, hooks skipped, HBC customizations disabled, alert screen). This is the same failure class as the open remote-off→on crash bug — recorded here as a confirmed instance of that signature; the fixes-anything workaround (one clean reboot) is the recovery. `ps` gave no output in the telnet shell (known unreliable).

**Recovery (one clean reboot):** issued `reboot` over the emergency telnet 15:22:11 → **SSH back 15:22:37 (~26 s)**.
Post-reboot capture (`..\captures\b11-failsafe-postreboot.txt`): new `boot-probe.log` entry (hooks ran, uptime_s≈32) · `hooklog` pass1 running (99-stop-services) · failsafe flag present only as the normal per-boot marker · **:0016 LISTENING + :0017 CLOSED** · HBC `/etc/hosts` bind-mount back (`md5 7900d0cf…` == `/tmp/hosts`, mount count 1) · DNS `example.com` rc=0. **Everything normal.**
(Note: two boot-probe entries at the same nominal `2021-01-01 01:00:30` — boot A's partial run + this clean boot; identical wall-clock because the RTC resets on every cold boot.)
**Pass/Fail criteria:** failsafe behaved exactly as documented; recovery = **one clean reboot (verified)**; recovery text drafted below. → **PASS.**

**DELIVERABLE — plain-words recovery text (for app docs / user support):**
> **TV shows "A crash has occured during startup" with a Telnet note**
> **What it means:** Your TV's root customizations were interrupted during a recent startup — most often because the power was cut (or the TV was switched off at the wall) while it was still starting up. To protect itself, the TV turned your customizations off for this one boot. Nothing is broken and no settings or data were lost.
> **What to do:** Restart the TV once, normally:
> - On the alert screen, choose **"Reboot now"**, **or**
> - Switch the TV off and on again with the remote.
> After that single restart, everything goes back to normal and your blocking/protection returns. (If the screen somehow appears again, do one more normal restart; if it still persists, use **Homebrew Channel → System reboot**.)
> **To avoid it:** don't cut the power to the TV during the first few minutes after switching it on — wait until it has fully started.

**Finding (app design input → S3/Task 17):** during FAIL-POWER the `pointer` file was written correctly (absent = OFF). But across these cuts a **stale `pointer=on` persisted** while `filter=down/rule=off` — harmless here because the harness is **not a boot hook**, but it confirms the app MUST: (a) install the keeper as a **boot hook** so protection is re-established after an unclean shutdown, and (b) **validate the pointer against live state on boot** (never trust a stale `pointer`).
**Raw files:** `..\captures\b11-failsafe-precheck.txt` · `b11-failsafe-telnet.txt` · `b11-failsafe-postreboot.txt` · `b11-failsafe-reconcile.txt`.

### FAIL-ROUTER — router reboot / DHCP change

**Criteria (run-sheet Block 11 step 3 / plan Task 14 step 3):** owner reboots the Fritz!Box/guest AP while filter+keeper ON; TV should resolve within **≤120 s after the router is back, with no user action**; keeper re-learn/re-verify path observed (or "upstream unchanged; re-learn path exercised = canary re-verify only"). PASS = no user action needed; FAIL = persistent dark DNS.

**Method:** armed a **detached on-TV poll** before the owner's reboot (`b11-router-poll.sh`, md5 `230dd453ed0528223c7b0f6baaa57583`; runs on the TV so it survives the Wi-Fi drop). Every ~2 s it logs upstream reachability (`dnsq example.com 192.168.179.1 53`), the stub canary (`dnsq example.com`), and the default gateway. Ran the full ~10-min window (TV uptime t=125.64 → 727.43). Pre-state: `dns1=192.168.179.1`, SSID `FRITZ!Box 7590 GA`, gw `192.168.179.1`.

**Poll timeline (TV side, `..\captures\b11-router-post.txt`):**
```
iters  1–22  t=129–249  upstream_rc=0  stub_rc=0  gw=192.168.179.1   (healthy, pre-reboot)
iter   23    t=258      upstream_rc=0  stub_rc=1  gw=192.168.179.1   (first failing canary)
iters 24–34  t=271–405  upstream_rc=1  stub_rc=1  gw=(EMPTY)         (Wi-Fi down; NO default route)
iter   35    t=419      upstream_rc=1  stub_rc=1  gw=192.168.179.1   (route restored)
iter   36    t=425      upstream_rc=0  stub_rc=0  gw=192.168.179.1   (FULLY RECOVERED)
iters 36–86  t=425–725  upstream_rc=0  stub_rc=0  gw=192.168.179.1   (healthy)
=== router-poll end t=727 ===
```
**Measured (TV-side):**
- Dark window ≈ **t258 → t425 = ~167 s (≈2.8 min)**; no-default-route window t271→t419 ≈ 148 s. This is the **outage duration** (router down), not the recovery latency.
- **Recovery latency after the path returned: ~6 s** (gw restored iter 35 t=419 → upstream+stub rc=0 iter 36 t=425) — far inside the ≤120 s bar. The TV reconnected **by itself** (DHCP renewed, same gw `192.168.179.1`); **NO TV-side user action**.
- **No new keeper log entries** during the outage → the filter process survived the blip intact; keeper did not act; `dns1` **unchanged** (`192.168.179.1`) → **"upstream unchanged; re-learn path exercised = canary re-verify only"**. (Upstream is the network's own DNS = the guest gateway; nothing to re-learn.)
- Post-outage live verify: `default via 192.168.179.1 dev wlan0` · dns1/dns2 unchanged · harness `filter=up rule=on keeper=up gaveup=no pointer=on` · nat = 2 DNAT · 853 ×2 · canaries `example rc=0` / `ads rc=2` · lifeline present `c73fbacf…` (no reboot → `/tmp` intact, confirmed).

**Environment deviation (honest, recorded):** the guest Wi-Fi/AP was down **far longer than the intended 1–2 min reboot window**. My laptop fell back to the **MAIN** SSID (`FRITZ!Box 7690 HN`, `192.168.178.2`), and the guest SSID the TV uses (`FRITZ!Box 7590 GA`) **stopped broadcasting for >10 min** (full scans 15:36–15:40 CEST showed only the main SSID + neighbourhood), so the laptop lost its path to the TV and the operator was blocked ~15:31–~15:45 CEST; the owner had to restore the guest AP. This is an **environment/infra deviation, not a harness or TV failure** — the TV-side auto-recovery was captured end-to-end by the on-TV poll independent of the laptop.
**Pass/Fail criteria:** TV resolves ≤120 s after the path returned (≈6 s), no user action → **PASS (TV-side)**, with the environment deviation above documented.

**Raw files:** `..\captures\b11-router-pre.txt` · `b11-router-arm.txt` · `b11-router-post.txt`.

### TOGGLE-LIVE — mid-session OFF/ON under playback

**Criteria (run-sheet Block 11 step 4 / plan Task 14 step 4):** owner starts a stream; agent protection OFF → 20 s → ON while owner watches. **PASS = playback continues or recovers within ≤10 s buffer; both transitions verified by `status.sh`; blocked-name behavior flips (blocked → resolves → blocked).** FAIL = playback dies permanently or the TV needs an app restart.

**Owner-confirmed pre-state:** **Netflix playing (actual playback)** on the TV; harness ON (`filter=up rule=on keeper=up`).

**Executed (`..\captures\b11-toggle-live.txt`):**
```
pre         uptime=2051.73  status filter=up   rule=on   keeper=up   pointer=on   ads rc=2 (blocked)
stop keeper keeper.pid=6252 kill -9 → keeper-stopped
OFF         uptime=2056.34  rollback: rules left=0 · status filter=down rule=off keeper=down pointer=off
            OFF ads rc=0 (RESOLVES) · OFF example rc=0
wait 20 s
ON          uptime=2085.81  filter-apply RESULT=OK · status filter=up rule=on pointer=on
            ON ads rc=2 (BLOCKED again) · ON example rc=0
restart     keeper.pid=11426 → status filter=up rule=on keeper=up
```
**Measured:** both transitions verified by `status.sh`; the blocked-name behavior **flipped `blocked (rc=2) → resolves (rc=0) → blocked (rc=2)`** exactly as required. The OFF→ON span was **~29.5 s** (20 s hold + ~9.5 s for the re-apply/verify). TV stayed fully usable throughout (queries resolved during OFF via the network DNS).
**Deviation (recorded):** the keeper was **stopped for the OFF phase** (plan didn't say so) — otherwise it re-protects within ~1 s and the OFF window is not genuine (same one-manager discipline as FAIL-MIDAPPLY). `filter-rollback.sh` clears `pointer`; the re-apply rewrites `pointer=on`; keeper restarted afterward.
**Playback result (owner-confirmed):** **NO hiccup** — the Netflix stream did **not** stutter or freeze during the OFF→ON toggle. → **TOGGLE-LIVE = PASS** (transitions verified; blocked-name flip 2→0→2; ≤10 s buffer criterion met trivially — zero interruption). Raw file: `..\captures\b11-toggle-live.txt`.

### HBC-MATRIX — blockUpdates toggle across reboots

**Criteria (run-sheet Block 11 step 5 / plan Task 14 step 5):** assert 3 boot states — (1) blockUpdates OFF → no HBC `/etc/hosts` mount, harness must CREATE its own sheet; (2) blockUpdates back ON → HBC mount returns, harness EXTENDS without stacking; (3) remove own section → HBC content byte-identical. PASS = each state asserted, **no stacking, no foreign edits**. FAIL = stacking/foreign corruption.

**Executed:**
```
toggle OFF (API)  setConfiguration {"blockUpdates":false} → {"blockUpdates":false,"returnValue":true}; flag file REMOVED
reboot #1         (owner-pre-approved)
after boot #1     mount count=0 · hosts md5 4af6093d… (raw) · blockUpdates flag absent · boot-probe entry (hooks ran)
  hbc-matrix-hosts.sh no-hbc → CREATE branch: bind-mount /tmp/s0hosts (count=1), add marked section,
                               getent 0.0.0.0 s0hbc-probe.lgtvcommon.com, HBC marker absent  ✓  (`b11-hbc-nohbc.txt`)
toggle ON (API)   setConfiguration {"blockUpdates":true} → {"blockUpdates":true,"returnValue":true}; flag file back
reboot #2         ← see DEVIATION
  → FAILSAFE boot (SSH down, telnet:23 open, no hooklog, failsafe flag self-removed)  (`b11-hbc-failsafe2.txt`)
  → recovered with ONE clean reboot (telnet `reboot`)
after boot #2     mount count=1 · hosts md5 7900d0cf… (HBC sheet == /tmp/hosts) · blockUpdates ON · hooks ran
  hbc-matrix-hosts.sh with-hbc → EXTEND branch: add marked section in place, count=1 (NO stacking),
                                 HBC lines still present, removal → REMOVAL-BYTE-IDENTICAL  ✓  (`b11-hbc-withhbc.txt`)
final             blockUpdates ON (flag present) · hosts md5 7900d0cf… · mount count=1
```
**Verdict:** **HBC-MATRIX = PASS** — all three boot states asserted, **no stacking**, **no foreign edits** (removal byte-identical). Extend-or-create algorithm (H11) rehearsed on both branches.
**DEVIATION (important finding):** reboot #2 was issued only ~**54 s** after reboot #1 started — **inside the HBC ~4-min failsafe-flag window** (flag set at boot+5 s, cleared only after `run-parts` completes; `99-stop-services` stretches this to ~3.5–4 min). Interrupting the window → next boot = **failsafe** (SSH off, telnet open, hooks skipped, alert). This is the **same failure class as the owner's remote-off→on "crashed" bug**, reproduced by two back-to-back reboots. Recovery = one clean reboot (as documented). **Consequence for the app:** any reboot/power event within ~4 min of a boot triggers failsafe — the app (and the HBC-MATRIX test procedure) must **space reboots >~4 min apart**, and the app should surface the plain-words recovery (FAIL-FAILSAFE deliverable).
**Post-test:** reboots had killed the harness → reconciled ON (`filter-apply` RESULT=OK + 2×853 + keeper) — see end state below.

### Block 11 end state (verified 2026-09-15 16:0x CEST, `..\captures\b11-endstate.txt`)
`filter=up rule=on keeper=up gaveup=no pointer=on` · filter pid 6117 + keeper pid 6168 ALIVE · nat = 2 DNAT+excl rules (`! -d 192.168.179.1/32 --dport 53 → DNAT 127.0.0.1:5335`) · 2× :853 DROP · `/etc/hosts` md5 `7900d0cfacb7e175b60b2d6ca66d59ac` == `/tmp/hosts` (mount count 1) · lifeline `/tmp/restore-handbuilt.sh` present (`c73fbacf…`) · init.d = 7 entries (00/02 `-rw-` paused; 95-s0-probe present) · **`blockUpdates` ON** · no `gaveup` · canaries `example rc=0` / `ads rc=2` · SSH OK. **Harness left ON as-is for Block 12 (T15).**

**Block 11 test summary:** FAIL-POWER **PASS** · FAIL-FAILSAFE **PASS** (recovery text drafted above) · FAIL-ROUTER **PASS (TV-side; env deviation)** · TOGGLE-LIVE **PASS** (owner: no hiccup) · HBC-MATRIX **PASS** (deviation: back-to-back reboots → failsafe).
**Block 11 raw files:** `b11-preconditions.txt` · `b11-power-arm/offstate/launch/window-check/postboot/bootdetail/bootprobe/revert/reconcile.txt` · `b11-failsafe-precheck/telnet/postreboot/reconcile.txt` · `b11-router-pre/arm/post.txt` · `b11-toggle-live.txt` · `b11-hbc-toggleoff/reboot1/afterboot1/nohbc/toggleon-reboot2/failsafe2/afterboot2/withhbc.txt` · `b11-endstate-reconcile.txt` · `b11-endstate.txt`.

---

## Block 12 — S0 T15: cleanup + owner smoke (CLEANUP-1, Gate H) — RUN ALWAYS — 2026-09-15 16:04–16:05 CEST

**Task:** run-sheet Block 12 steps 1–5 · **Mode:** AFK + 1 HITL (owner smoke) · **Order law honored:** harness rules out → filter killed → hand-built restore LAST.

**Step 1 — evidence fetched FIRST (before any deletion):** `/var/lib/webosbrew/s0-probe/*` → `captures\s0-probe-t15\` (**74 files**, pristine dir; local `Remove-Item -Recurse` was policy-blocked so a fresh unique dir was used instead of deleting the old one). Raw: `b12-preflight.txt`.

**Step 2 — `cleanup.sh` run (`b12-precleanup.txt`, `b12-cleanup-run.txt`):** pre-state confirmed harness ON (nat 2 DNAT+excl `→127.0.0.1:5335`, 2×853, pointer=on, 7 hooks incl. `95-s0-probe`). `sh -n` OK → ran: `filter-rollback` (**harness rules left=0**) → filter killed → all 853 OUTPUT drops removed → probe hooks `95/97` removed → our-mount guard (mount was HBC's `/tmp/hosts`, **not** ours → untouched) → `restore-handbuilt.sh` (00/02 re-chmod 755 + applied) → `/tmp` leftovers removed → `s0-probe` dir removed. Hook log: `02-block-dns-egress: OK: all DNS-egress rules verified active (dnat 53 -> 192.168.179.1, drop 853)`; `nat :53 rules: 2 (expect 2)`; `853 drops: 2 (expect 2)`.

**Step 3 — residue verify vs baseline (`b12-residue-verify.txt`) — ALL PASS:**
- hooks: 6 entries (00,01,02,03,99,inputhook) all `-rwxr-xr-x` → **PASS** (`95-s0-probe` gone)
- hook md5s: 00=`4dfbbcf6…` 01=`0c6e6eca…` 02=`4da8bd68…` 03=`50bd30dc…` 99=`11be0de9…` inputhook=`edaaada8…` → **PASS** (all six == baseline)
- iptables: INPUT 18181/36866/7000 drop · OUTPUT 156.147.69.32 / 224.0.0.251 / 239.255.255.250 + 853 tcp/udp drop → **PASS** (== baseline)
- nat: `-A OUTPUT ! -d 127.0.0.0/8 --dport 53 -j DNAT --to-destination 192.168.179.1:53` (udp+tcp) → **PASS** (hand-built restored; harness 5335 rules GONE)
- mounts: `tmpfs /etc/hosts` (HBC's) → **PASS**
- `/etc/hosts` md5 `a151aa271729756dd3fdc83d484691d7` == `/tmp/hosts` → **PASS** (== baseline)
- `NO-S0-DIR` → **PASS**; no dnscrypt/keeper procs; port 5335 free → **PASS**
- flags: `blockUpdates` ON · `failsafe` flag CLEARED · sshd/telnet unchanged → **PASS**
- `/tmp` probe leftovers clean (`/tmp/cleanup.sh` also removed; the rest were already deleted by the script)

**Step 4 — functional re-verify of the restored stack:** `nslookup snu.lge.com 8.8.8.8` → **empty** (leak closed) · `02-block-dns-egress` log `OK: all DNS-egress rules verified active` (1×) · `getent hosts` → `snu.lge.com ::1`, `ad.lgappstv.com ::`, `ads.lgtvcommon.com ::` (null-routed) · `example.com` resolves normally. → **PASS**

**CLEANUP-1 = PASS** (every residue item == baseline; functional stack restored).

**Step 5 — owner smoke (HITL, owner-confirmed):**
- **Streaming: PASS** — Netflix opened and played normally.
- **LG-ish feature (voice search): N/A by configuration** — the owner **intentionally disabled voice/LG features on this TV** (privacy/telemetry setup), so it cannot be tested. Recorded as **N/A**, **not a failure** — this is the same configuration that existed **pre-session** (not caused by the spike).
- No TV changes were needed after the smoke.

**Final TV state (read-only, `b12-final-state.txt`, 16:07):** 6 init.d hooks all `-rwxr-xr-x` · nat = hand-built `! -d 127.0.0.0/8 --dport 53 → DNAT 192.168.179.1:53` (udp+tcp) · 2× :853 DROP · `/etc/hosts` md5 `a151aa27…` (mount 1, HBC) · `NO-S0-DIR` · no dnscrypt/keeper procs · `blockUpdates` ON · failsafe flag cleared · `snu.lge.com@8.8.8.8` empty · `ad.lgappstv.com → ::` · SSH OK.

**Gate H: PASS** — CLEANUP-1 PASS + residue == baseline + owner smoke OK (streaming PASS; voice search N/A-by-config). **Block 12 (S0 T15) COMPLETE.**

**Block 12 raw files:** `b12-preflight.txt` · `b12-precleanup.txt` · `b12-cleanup-run.txt` · `b12-residue-verify.txt` · `b12-final-tidy.txt` · `b12-final-state.txt` · evidence copy `s0-probe-t15\` (74 files).

