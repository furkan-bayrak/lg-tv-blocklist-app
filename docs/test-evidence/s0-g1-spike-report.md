# LG TV Blocking App — S0 Validation Spike Report

## 1. Header

**Date:** 2026-09-15 · **Status:** FINAL (assembled after session close; no commits, no pushes)
**Device (tested):** LG OLED55G19LA — "SlopBro" (board O20_DVB) · webOS 6.5.3 (core_os_release 6.5.3-47, build 20250913080742) · kernel `4.4.84-229.kcl4tv.6` · aarch64 kernel + **32-bit ARM userland** (`getconf LONG_BIT=32`) · Node v8.12.0 · rooted Homebrew Channel (root:true, telnetDisabled:true, sshdEnabled:true, blockUpdates:true)
**Device (pending):** rugk's C5 (webOS 7+) — probe bundle prepared (`rugk\probe.sh`, `rugk\message-draft.md`), **not dispatched** (owner-gated); RUGK-1 NOT RUN → modern-firmware claims stay unverified (D16)
**Session:** 2026-09-15 11:11–16:07 CEST; live over SSH from laptop (guest WLAN 192.168.179.x → TV 192.168.179.8); owner HITL for smokes, reboots, both power cuts, router reboot; abort word unused; TV fully restored (Gate H PASS).
**Procedure revision:** plan `2026-09-14-lg-tv-app-s0-validation-spike-plan.md` executed via `app-s0\SESSION-RUNSHEET.md`; recorded session amendments — side port 5353→5335 (LG `iconnectivity` holds 5353); takeover mechanism REDIRECT+owner-match → DNAT-to-self + upstream-exclusion loop-avoidance (Task 8 kernel verdict); `kill-matrix.sh` poller fix; variant-B manual apply leg. Source of truth: `g1\capture-g1.md` (Blocks 0–12) + `captures\`.
**Headline:** one working in-path mechanism proven end-to-end on the G1 (DNAT-to-self + dnscrypt filter; DoT cut in combined mode); hosts layer demoted by measurement; one gated finding — the single-keeper design fails the kill matrix (Gate G FAIL) → mandatory keeper-robustness track in S3/S4. No guard-only fallback required.

---

## 2. Pass/fail table

One row per test ID; verdict + one-line evidence pointer. Additional capture-internal IDs included for completeness (marked).

| Test-ID | Verdict | Evidence (one-line) |
|---|---|---|
| BASE-1 | PASS | `captures\baseline-20260915-120241.txt` (261 lines, complete + parseable); pre-pause fingerprint (md5s, rules, mounts, env) recorded |
| PAUSE-1 | PASS | Exactly the 02-hook rules removed (DNAT :53 ×2 + 853 drops ×2); hooks 00/02 `-rw-` (no x bit); nothing else changed vs baseline |
| BOOT-1 | PASS | Probe fired at uptime 33 s; exactly 1 `/etc/hosts` mount = `/tmp/hosts` bind (inode `36:47960` both paths); HBC marker line 10; boot→SSH ≈60 s; aarch64; node v8.12.0; failsafe flag present (mid-window) |
| MOUNT-1 | PASS | M1 count=1 source `/tmp/hosts` (inode 36:47960) · M2 file+`getent` visible · M3 removal byte-identical · M4 kernel ALLOWS stacking (2→1 clean) · M5 `sed -i` EROFS fail → **in-place rewrite only** · mount intact at end |
| FW-1 | PASS (recording complete; 2 negative capability findings) | F1/F2/F4/F7 OK; **F5 REDIRECT ABSENT**; **F6 owner-match ABSENT** (kernel target/match lists + reversible rule-add rc=1 + modprobe FATAL + no .ko); F7 zero residue. `captures\fw1-run-20260915-121709.txt`, `fw1-diag-…`, `fw1-modclosure-…` |
| MECH-1 | COMPLETE (PASS) | M2 IMPOSSIBLE-by-kernel (capability, not fail); **M3 DNAT-to-self WORKS** — `ads.lgtvcommon.com` via 8.8.8.8 → `rcode=5` REFUSED + blocked-names.log entry; self-loop caveat measured; M4 connmand **RESPAWN=no**, manual restart OK (pid 6743). `captures\m4-run-…`, `m4-runout-…`, `mech-m2m3-run3-…` |
| EXEC-1 | PASS | No exec timeout ≥120 s (`sleep 120` rc=0); **stdout cap = 204,800 B (200 KiB)** → `returnValue:false` `"stdout maxBuffer exceeded"`, child killed, **luna rc still 0 → rc unreliable**; no concurrency lock (2×8 s = 8 s); spawn streams 4 events (bounded reader needed); stdoutString kept on error; status markers intact. `captures\exec1-run-20260915-131053.txt`, `exec1-cap-…json` |
| TRANSPORT-1 | PASS | curl 7.61.0 rc=0 both targets (raw.githubusercontent SHA256SUMS 500 B — line-identical to repo copy; GitHub release minisig 333 B incl. redirect); `sha256sum` present; addendum: real list fetch → hash == published sum; tamper copy differs. `captures\transport1-run-…`, `transport1-addn-…` |
| UPSTREAM-1 | PASS | `dns1=192.168.179.1` (working upstream); `dns2`/`dns3` = DHCPv6 ULA (not v4 targets); resolv.conf `::1`/`127.0.0.1`; default via 192.168.179.1 dev wlan0. `captures\upstream1-run-…`, `upstream1-getstatus-…json` |
| SIGNING-1 | PASS | Static verifier RUNS on G1: aead/minisign v0.3.0 linux-arm64 (1,769,624 B, sha256 `3b9bb358…`) — C-minisign prehashed + legacy sigs verified rc=0, tamper rejected, `-H` enforced; stock crypto unusable (OpenSSL 1.0.2r, no Ed25519). `captures\signing1-verify-20260915-132132.txt` |
| DETECT-1 | PASS (after 3 tunes; detector v2 md5 `1531fc53…`) | Clean = all false; m1→D2 (+D3 genuine stack), m2→D4, m3→D5, D1-mock→D1; each fixture removed clean. `captures\detect1-clean3-…`, `detect1-m1b-…`, `detect1-m2-…`, `detect1-m3-…`, `detect1-d1mock-…` |
| EFF-HOSTS | PASS (recorded; deviation flagged) | hosts `getent` 5/5 → `0.0.0.0`; stub/direct NODATA identical pre==post (network-side AGH style); **B: literal 5/5 vs hosts-attributable 0/5**. `captures\eff-p1-hosts-…`, `eff-p1-attribution-…` |
| EFF-FILTER | PASS | 5 list names + zone subdomain all `rcode=5` REFUSED via filter AND stub paths; `example.com` OK (FORWARD 8 ms, no loop); zone `*.lgtvcommon.com` matched; status `filter=up rule=on keeper=up`. `captures\eff-p2-apply-…`, `eff-p2-filter-…` |
| EFF-COMBINED | PASS | 6/6 REFUSED via filter+stub; `example.com` OK; **853 DROP proven** (openssl 5 s-killed vs 443 control handshake; pkts 3→9); per-layer deltas recorded. `captures\eff-p3-combined-…`, `eff-p3-853verify-…` |
| EFF-VARIANTS | PASS | B = `rcode=0` + `A=0.0.0.0` (AAAA `::ffff:0.0.0.0`); A = `rcode=5` REFUSED — both deterministic 6/6; **A kept active** (provisional). `captures\eff-variants-b-…`, `eff-variants-a-…` |
| EFF-BYPASS | PASS (recorded) | hardcoded-53 no escape (`rcode=5`); DoT 853 dropped (2 targets 5 s-killed); v6 ULA-only/no global path AND unfilterable (no `ip6_tables`); **DoH/443 reachable HTTP 200 — `snu.lge.com` (filter REFUSED) resolved via DoH to live AWS IP = documented limit**. `captures\eff-bypass-…`, `eff-bypass-supp-…` |
| EFF-PLAYBACK | PASS (Gate F) | Owner-confirmed ~1 h Prime Video with filter ON (variant A) — no stutter, no error card, no failed app start |
| SMOKE-1 *(capture-internal; Gate C)* | PASS | Owner-confirmed Netflix after pause (Block 2) |
| KEEP-1 | PASS (S1 = **ALIVE**, S2 = **ALIVE**; S3 priced, not validated) | S1: boot-hook sleeper pid 5003 alive @+146 s, PPid=1, cgroup `/system.slice/ls-hubd.service` · S2: exec-launched pid 8581 alive @+90 s · S3: `elevate-service` cannot register a new service (`Service does not exist`). `captures\b10-step1-keep.txt`, `b10-step2-exec-bg.txt`, `b10-step3-s3.txt` |
| FAIL-DEL | PASS (deviation: give-up non-terminal) | rollback → **DNS-OK @0 s**; 3 attempts/cycle then re-tries (5+ attempts counted); give-up @+31 s; steady "protection off, TV works". `captures\b10-step4-faildel.txt` |
| FAIL-MIDAPPLY | PASS | Each of the 3 stages was coherent — stage3/stage4 rule=off/filter=up, stage5 rule=on/filter=up; **no dead-filter-at-rule-on stage at all**; reconcile `RESULT=OK` ×3. `captures\b10-step5-midapply.txt` |
| FAIL-MATRIX | **FAIL** | F/K all-OK (zero DNS impact); **FK/KF/BOTH `still_FAIL_at_end` + mixed state (rule=on/filter=down/keeper=down)** — dark until external reconcile; **Gate G FAIL → mitigations required**. `captures\b10-step6-matrix.txt` |
| FAIL-POWER | PASS | Mid-apply (held at stage5) cut → coherent auto-OFF (pointer never written); TV booted + worked, no manual SSH needed; finding: harness has no boot reconcile. `captures\b11-power-postboot.txt`, `b11-power-bootprobe.txt` |
| FAIL-FAILSAFE | PASS | Boot-window cut reproduced the failsafe signature exactly (SSH off, telnet :23 open, hooks skipped, HBC mounts absent, alert screen); recovery = **one clean reboot** (~26 s to SSH); plain-words recovery text drafted. `captures\b11-failsafe-telnet.txt`, `b11-failsafe-postreboot.txt` |
| FAIL-ROUTER | PASS (TV-side; environment deviation recorded) | Dark ≈167 s (guest-AP outage); **recovery ≈6 s after path returned**; no user action; dns1 unchanged → canary re-verify only. `captures\b11-router-post.txt` |
| TOGGLE-LIVE | PASS | blocked-name flip 2→0→2; both transitions verified by `status.sh`; owner: Netflix **no hiccup**. `captures\b11-toggle-live.txt` |
| HBC-MATRIX | PASS (deviation: back-to-back reboots → failsafe) | 3 boot states asserted; CREATE branch (no HBC mount) + EXTEND branch (no stacking); removal byte-identical. `captures\b11-hbc-nohbc.txt`, `b11-hbc-withhbc.txt`, `b11-hbc-failsafe2.txt` |
| CLEANUP-1 | PASS (Gate H) | Every residue item == baseline (6 hooks + md5s, iptables both tables, mounts, hosts md5 `a151aa27…`, no s0 dir); functional stack restored (`snu.lge.com@8.8.8.8` empty); owner smoke Netflix OK. `captures\b12-residue-verify.txt`, `b12-final-state.txt` |
| RUGK-1 | **NOT RUN / deferred** | Bundle prepared (`rugk\probe.sh`, `rugk\message-draft.md`); dispatch owner-gated (run-sheet "After the session"); no C5 results exist → modern-firmware claims unverified (D16) |

**Notes:** pre-session S1-T5 leg (app install/launch/hook/uninstall; **Gate B PASS**) ran in the same window — not an S0 test ID; recorded in capture Blocks 0–1. **Gates: B PASS · C PASS · D PASS · F PASS · G FAIL (mitigation-gated) · H PASS.** Counts: **29 table rows — 24 S0-test PASS · 1 FAIL · 1 NOT RUN (RUGK-1) + capture-internal extras (SMOKE-1, EFF-PLAYBACK, CLEANUP-1) shown for completeness.**

---

## 3. Go / No-Go / Guard-only

**VERDICT: GO — filter-dependent S3+ build work is unblocked. Not GUARD-ONLY; not NO-GO.**

Against the plan's formula (Task 17 §3) — triggers for NO-GO / GUARD-ONLY:

1. **"No working in-path mechanism" — NOT met.** DNAT-to-self captured TV-originated queries (incl. hardcoded resolvers) and enforced the filter: `ads.lgtvcommon.com` via 8.8.8.8 → REFUSED with a blocked-names.log entry (M3); 6/6 list+zone names REFUSED via stub AND filter paths (EFF-FILTER/EFF-COMBINED); hardcoded-53 shows no escape (EFF-BYPASS). The plan's primary REDIRECT+owner-match shape is impossible on this kernel (FW-1 F5/F6), but the fallback mechanism works end-to-end and the loop-avoidance (`! -d 192.168.179.1/32`) is validated.
2. **"Hosts layer unmeasured" — NOT met.** EFF-HOSTS measured both readings (literal 5/5 stub-path no-answer; hosts-attributable 0/5) → demotion decision in §5.
3. **"Kill matrix leaving dark DNS beyond criteria WITHOUT a proven mitigation" — partially met; recorded as the one gated item.** FK/KF/BOTH failed (dark + mixed state, FAIL-MATRIX; Gate G FAIL). Mitigations: (a) **second watchdog** — placement viability *proven* (S1: boot-hook-launched background processes survive; cgroup `ls-hubd.service`), recovery behavior not yet built/tested; (b) **elevated-service keeper** — priced, **not validated**; (c) **deadman/fail-open design** (keeper death removes rules; resolv-free variant) — not yet built. Per the run-sheet gate rule these are concrete mitigations **explicitly scheduled as must-prove in S3/S4**, so the gate is assessable — but the **single-keeper design is rejected for the app**. None of the mitigations is proven yet; GUARD-ONLY is not triggered because a concrete, testable mitigation path is identified and scheduled as S3 build + S4 must-prove — owner to ratify.

**Unblocked (S2/S3 build work can start):** filter vehicle + input format; DNAT takeover with runtime capability probe + fallback ladder; blocked-response default A; status contract (delimited block; `returnValue`-based checking); exec discipline (single-flight lock; spawn+sentinel >60 s; no bulk output); transport (curl + SHA-256 chain); signing (static Go verifier in CI); hosts extend-or-create (in-place rewrite only; stacking refusal); detector conditions; storage paths; honest-limits copy.

**Blocked / conditional until proven:**
- **Keeper survivability architecture** (S3 design + S4 must-prove): boot-hook watchdog + deadman fail-open + pointer-vs-live boot reconciliation; FK/KF/BOTH recovery ≤60 s, no persistent mixed state.
- **"Protection stays on" claims** — none until the keeper set is proven; interim honest copy = "protection can be left off after an unclean event; re-arm is documented" (failure-suite evidence is what makes this claim honest).
- **Elevated-service variant** — S4 input (registration unresolved).
- **Modern-firmware (webOS 7+) / C5 claims** — RUGK-1 pending (D16: claim only what is tested).
- **DoH-over-443 bypass** — structurally not fixable at the DNS layer → documented limit (copy task, S5).

---

## 4. Pinned parameters (the S0 deliverables)

**CONFIRMED** = measured/validated this session · **PROPOSED** = plan default stands, session did not contradict it · **STILL OPEN** = decision deferred.

| Parameter | Status | Value + evidence |
|---|---|---|
| Filter vehicle | **CONFIRMED** | dnscrypt-proxy 2.1.18, linux_arm (32-bit) static; binary sha256 `c5af4b287084d82fbf7cefa6833cdf865efe12e4286b56b9ceaf46de310007f7` (source: `candidate\dnscrypt-proxy`; capture-g1.md records only md5 `306395ff…`); catch-all variant `forwarding_rules = '. 192.168.179.1'` (owner decision 2026-09-14, `decision-log.md`); no runtime downloads; runs on-device. S3 regression items reserved: cosmetic "waiting for at least one server" state; `.` catch-all is code-supported but undocumented. |
| Filter input format | **CONFIRMED (semantics)** | `=name` exact-only / `name` apex + all subdomains (deep incl.) — validated locally (`filter-pricing.md` §F4 matrix) AND on-device (T12: 5 exact + zone `*.lgtvcommon.com` blocked; exact-only counter-proof). Spike input = 125 lines (115 exact + 8 zone + 2 comments); region rule drops `us.*` (only `us.lgtvsdp.com` dropped at that repo revision). "Counted unit = unique effective hostnames" stays a **PROPOSED** config-side convention (not contradicted; D15 live-count rule unaffected). |
| Takeover mechanism (G1) | **CONFIRMED** | DNAT-to-self on OUTPUT :53 → `127.0.0.1:5335` (udp+tcp) **+ upstream exclusion `! -d 192.168.179.1/32`** for loop-avoidance. Fallback ladder: (1) REDIRECT+owner-match — kernel-dependent, impossible here (keep as design option behind a runtime capability probe); (2) DNAT+exclusion — G1-confirmed; (3) DNAT without exclusion — self-loop measured, rejected; (4) connmand `--nodnsproxy` take-over — plan-stage fallback; not exercised this session. Side port 5335 (5353 held by LG `iconnectivity`). |
| Blocked response mode | **PROVISIONAL A (`refused`, rcode 5)** | A validated by owner playback twice (Gate F ~1 h Prime; TOGGLE-LIVE Netflix); B (`a:0.0.0.0,aaaa::`) deterministic at protocol level (`NOERROR` + `0.0.0.0` / `::ffff:0.0.0.0`) but never owner-playback tested → default A; final choice stays with the owner (risk of REFUSED disliked by some app is low per evidence, not zero). |
| Service-swap "N" | **PROPOSED** | N = 20 applies @ 100% status fidelity; any double-apply → immediate swap. Session evidence: no double-apply observed; status block correct at every checkpoint (T12–T14); N=20 not exercised on-device. |
| State/log paths + caps | **PROPOSED (paths) / CONFIRMED (persistence facts)** | Proposed `/var/lib/webosbrew/lg-tv-blocklist-app/` (state.json, journal, lists/, logs/, 64 KB × 2 rolling). Validated: `/var/lib/webosbrew` writable and persistent across reboots AND power cuts (probe dir + logs survived); `/tmp` is volatile (wiped on power loss — lifeline loss evidence); no on-device rotation exercised. |
| Exec operational pins | **CONFIRMED capabilities / PROPOSED thresholds** | No server-side timeout ≥120 s; stdout cap **204,800 B** → check `returnValue`, never rc; no concurrency lock → UI single-flight + script-side lock required; spawn needs bounded reader; long-lived exec children must detach stdio; status block ≤2 KiB feasible (214 B round-trip). "Scripts ≤60 s else spawn+sentinel" remains the proposed policy (capability tolerates ≥120 s). |
| Transport | **CONFIRMED** | curl 7.61.0 sufficient (both URLs rc=0, redirect followed, no TLS errors); `sha256sum` on-device; fetch → hash == published chain + tamper control work. Tool order pin: curl → wget → busybox wget (only curl exercised; wget present). |
| Signing | **CONFIRMED FEASIBLE → pin static Go verifier** | aead/minisign v0.3.0 linux-arm64 static verified real C-minisign signatures on-device (prehashed + legacy), tamper rejected, `-H` enforced. Recommendation: CI emits verifier (`GOARCH=arm64`, `CGO_ENABLED=0`; optionally also armv7 for 32-bit-only userlands); vendor-with-hash alternative acceptable. Honest SHA256-only wording NOT required as primary position. |
| Keeper placement | **CONFIRMED FACTS → design decision** | Boot-hook-launched bg processes **survive** (S1; the plan's cgroup-kill assumption is wrong); exec-launched survive with stdio detached (S2); elevated service **cannot be registered** with the plan's recipe (S3: patches-only; `Service does not exist`). App keeper = boot hook + watchdog; single-keeper rejected (FAIL-MATRIX). |

---

## 5. Demotion decision (hosts layer)

**DECISION: DEMOTE.** The hosts layer is demoted from "claimed layer" to **coexistence shim / supplementary** (plan rule: `B ≤ 1/5` → demote, plus the measured note).

**Measured numbers (EFF-HOSTS):**
- Stub-path "no usable answer" (literal reading): **5/5** — but this outcome is **network-side AGH behaviour**, not ours (identical pre-append and post-append; attribution probes recorded).
- **Hosts-attributable stub-path change: 0/5** (pre == post; the stub path ignores the hosts layer entirely).

**What each layer actually adds (per-layer deltas, EFF-COMBINED):** DNAT+filter carries all DNS enforcement on both query paths (stub and direct); the firewall layer adds the DoT 853 cut; the hosts layer uniquely adds the `getent`/glibc exact-name null-route (`0.0.0.0`) — exact hostnames only, no zone semantics.

**Spec sentence to change (§3/§7)** — replace equal-layer presentation with (proposed wording):
> "The three layers are never presented as equal: the DNS layer (filter capture via DNAT) and the firewall layer (DoT cut) carry enforcement; the hosts layer is a supplementary coexistence shim (exact-name null-route) and does not, by itself, stop querying."

Also carry into §7 the measured note: *"measured 0/5 hosts-attributable stub-path change; the literal 5/5 no-answer rate is AGH-mediated and must not be cited as hosts efficacy."*

---

## 6. Honest-limits updates

- **DoH-over-443: reachable, proven.** Live: `snu.lge.com` was REFUSED by our stack but resolved via Cloudflare DoH (HTTP 200) to a live AWS IP (`52.78.227.93`); `1.1.1.1` and `cloudflare-dns.com` endpoints both answered. Not fixable at the DNS layer (needs SNI/IP-level control — out of scope) → must appear in honest copy.
- **DoT-853: covered only while the firewall layer is ON** (two targets blackholed in combined mode, counter-corroborated). With only the DNS layer, DoT is reachable → scope the claim.
- **IPv6: ULA-only on this network, no global path — and unfilterable on this kernel** (no `ip6_tables`; FW-1). UI statement stays: "Active — IPv4 only; IPv6 DNS unfiltered on this TV".
- **Hardcoded-53 resolvers: no escape while the mechanism is on** (DNAT captured 8.8.8.8 traffic; measured) — the plan's core goal met.
- **connmand kill: ~7–8 s device-local DNS gap on this build, no respawn** (labeled inference for the gap: `:53` sockets owned by connmand die with it). App must not manage connmand in v1.
- **Boot events inside the ~4-min failsafe window → failsafe boot** (reproduced twice, incl. deliberately). Recovery = one clean reboot; plain-words text drafted (FAIL-FAILSAFE deliverable).

---

## 7. Failure-suite findings + mitigations → S3/S4 slices

Every FAIL/ledger finding paired with a concrete mitigation and the slice that must prove it (plan Task 17 §7).

| # | Finding (evidence) | Required mitigation | Must prove in |
|---|---|---|---|
| 1 | **FK/KF/BOTH: dark DNS + mixed state (rule=on/filter=down)** with keeper dead — `b10-step6-matrix.txt` | Reject single-keeper: boot-hook **watchdog** (placement viability proven, S1) + **fail-open deadman** (rules removed on keeper death) + one-manager discipline | S3 build, S4 prove (recovery ≤60 s, no mixed state) |
| 2 | **Keeper self-recovery leaves `pointer=OFF` while protection ON** (matrix pre-recovery status) | Pointer must be rewritten after recovery / derived from live state; never trust pointer alone | S3 |
| 3 | **Give-up is non-terminal** — keeper re-enters retry after `gaveup` (FAIL-DEL: 5+ attempts) | App keeper: give-up terminal; steady "protection off, TV works"; surfaced in UI | S3 |
| 4 | **No boot-side reconciliation** — after power loss the harness stays OFF (FAIL-POWER) | Keeper as **boot hook** that reads pointer+journal, validates against live state, re-arms or cleans | S3 design, S4 prove (power-cut leg) |
| 5 | **Stale `pointer=on` survives unclean shutdown while filter=down** (FAIL-FAILSAFE capture) | Boot: pointer-vs-live validation; never assume pointer truth | S3 |
| 6 | **~4-min failsafe window**; events inside → failsafe boot (reproduced ×2: session start + HBC-MATRIX reboot #2) | Space app-triggered reboots >~4 min; never trigger boot flows inside the window; ship the plain-words recovery text | S3 (UI/support), S4 (procedure) |
| 7 | **`/exec` blocks while a background child holds stdio** (S2 first launch hung) | Bridge must detach stdio for long-lived children (`>/dev/null 2>&1`); bounded readers for `spawn` | S3 |
| 8 | **`/exec` cap 200 KiB kills the child; luna rc=0 on failure** (EXEC-1) | Never bulk output; status block only; check `returnValue`; sentinel files for long ops | S3 |
| 9 | **No concurrency lock** (EXEC-1: 2×8 s ran concurrently) | UI single-flight + script-side lock (port/pid collision evidence: FAIL-MIDAPPLY keeper-vs-apply race) | S3 |
| 10 | **Kernel lacks REDIRECT/owner-match; unknown kernels may differ** (FW-1) | Runtime capability probe + mechanism ladder; graceful "degraded (no firewall layer)" path | S3 |
| 11 | **DNAT without exclusion self-loops** the filter's own upstream traffic (M3) | Always apply upstream exclusion; end-to-end canary before commit (D12 order) | S3 (shape validated) |
| 12 | **connmand: no respawn, 7–8 s DNS gap** (M4) | Do not touch connmand in v1; document | S3 (design guard) |
| 13 | **Detector D5 would flag our own rules** (no owning label) | App rule set registers a known label OR detector learns the app's rules | S3 |
| 14 | **Mount stacking allowed by kernel** (MOUNT-1 M4) | Refuse-and-report on stacked mounts (D11); enforce exactly-one-mount invariant | S3 |
| 15 | **`sed -i` impossible on `/etc` (EROFS)**; rename semantics can never be used | In-place content rewrite only (`cat new > mounted-file`) — pinned | S3 |
| 16 | **Platform probes unreliable**: `ps w` hides orphans; `netstat` no `-p`; `/proc/mounts` hides bind sources; RTC resets to 2021 on cold boot (FAIL-POWER/FAILSAFE) | Use `/proc`, `/proc/self/mountinfo`, inode→pid maps; UI must not trust wall-clock freshness | S3 |
| 17 | **Elevated-service registration unresolved** (S3 attempt: `Service does not exist`) | Either prove via devmode/manifest flow or drop the variant | S4 input |
| 18 | **Blocked-response mode B untested with real apps** (only protocol-level) | Optional owner playback check on B before finalizing copy | S4 (small) |

---

## 8. Evidence index

- **Master capture log (source of truth):** `g1\capture-g1.md` — Blocks 0–12, every entry with command → raw output → criteria → verdict.
- **Raw captures:** `captures\` (all per-test files; key files cited in the table above). Highlights: `baseline-20260915-120241.txt`; `fw1-run-…` + `fw1-diag-…` + `fw1-modclosure-…`; `m4-run-…`; `exec1-run-…` + `exec1-cap-…json`; `transport1-…`; `upstream1-getstatus-….json`; `signing1-verify-…`; `detect1-*` (clean3/m1b/m2/m3/d1mock); `eff-*` (p1/p2/p3/variants/bypass); `b10-*` (step1–6, endstate); `b11-*` (power/failsafe/router/toggle/hbc/endstate); `b12-*` (residue/final-state).
- **Full TV-side probe-dir snapshot:** `captures\s0-probe-t15\` (74 files — baseline, `boot-probe.log`, `efficacy-*.txt`, `kill-*.timeline`, journal, filter/keeper/blocked logs).
- **Harness scripts (local + TV):** `g1\` — `filter-apply.sh`, `filter-rollback.sh`, `keeper.sh`, `status.sh`, `efficacy-run.sh`, `kill-matrix.sh`, `dnsq.js/.sh`, `mech-probe.sh`, `firewall-contract.sh`, `foreign-detector.sh`, `exec-ceiling.sh`, `transport-/upstream-/signing-probe.sh`, `pause-/restore-handbuilt.sh`, `cleanup.sh`, `95-s0-probe`, `hbc-matrix-hosts.sh`; backups `*.pre-dnat-loopfix`, `kill-matrix.sh.pre-pollfix`.
- **Candidate artifacts:** `candidate\` — `dnscrypt-proxy` (binary), `dnscrypt-proxy.toml` (+ `.variant-b`), `filter-s0.txt`, `forward-rules.txt`, `filter-pricing.md` (F1–F7 + dry-run matrices), local dry-run configs.
- **S1 leg evidence:** capture Blocks 0–1 (install/uninstall; Gate B; IPK sha `3d32927f…`).
- **rugk bundle (undispatched):** `rugk\probe.sh`, `rugk\message-draft.md`.
- **Recon deltas (this session):** `report\recon-deltas.md` + appended block in `app-recon-2026-09-14.md`.

No images/screenshots were captured; all evidence is text/JSON in the paths above.

---

## 9. Open items / spec gaps found

1. **RUGK-1 / C5 leg** — not dispatched (owner-gated). Until run: no modern-firmware claims (D16); probe bundle is ready.
2. **Keeper-robustness track** — design (S3) + must-prove (S4): watchdog, deadman, pointer reconciliation; kill-matrix FK/KF/BOTH re-test with ≤60 s AUTO-recovery criterion.
3. **Elevated-service variant** — registration unresolved (needs devmode/manifest flow or reboot rescan) → S4 input.
4. **Service-swap N=20** — not exercised; keep the double-apply watch in S3 acceptance.
5. **Blocked-response mode** — A provisional; optional owner playback on B; finalize copy.
6. **State/log persistence layout** — path + rolling caps still proposed; validate in the real app directory (S3).
7. **Spec §3/§7 edit** — demotion sentence (see §5) must land in the spec.
8. **Harness hygiene (non-blocking, for run-sheet reuse):** `upstream-probe.sh` compare-grep pattern (pretty-printed JSON); `signing-probe.sh` pipeline-rc echo (`ed25519 gen OK` artifact); `nc -z` → `openssl s_client` for DoT checks; `timeout` needs `-t`; `s3-elevated-service.sh` line-29 quoting defect; `cleanup.sh` cosmetic REDIRECT comments; `status.sh` raw pointer print; `firewall-contract.sh` 5335 text updated but not re-run (kernel property, verdict unchanged).
9. **Detector known-set** — production must add the app's own future hook/rule signatures (S3).
10. **DoT/DoH/IPv6 copy** — honest-limits wording finalized (S5).

---

## 10. Recon deltas

Full delta list (also written to `report\recon-deltas.md` and appended to `app-recon-2026-09-14.md` as "S0 session updates (2026-09-15)"):

1. **Arch:** kernel `aarch64` but **32-bit ARM userland** (`getconf LONG_BIT=32`); 32-bit `linux_arm` binaries run; arm64 static binaries also run (kernel is aarch64) — asset matching must account for both.
2. **Node present:** `/usr/bin/node` v8.12.0 — query‑helper path viable; Node 8‑safe code required.
3. **Kernel/iptables:** kernel `4.4.84-229.kcl4tv.6`; iptables v1.6.2 (`xtables-multi`) — full iptables, not busybox.
4. **REDIRECT target: NOT available** (absent from `/proc/net/ip_tables_targets`; `libipt_REDIRECT.so` userspace-only; no `.ko`; `modprobe` FATAL).
5. **owner match: NOT available** (same class; `modprobe xt_owner` FATAL) → `-m owner --uid-owner` impossible on this kernel.
6. **DNAT-to-self works** (`nat OUTPUT --dport 53 → 127.0.0.1:5335`); without exclusion the filter's own upstream traffic is re-captured → bounded self-loop; **`! -d <upstream>` exclusion works** (validated shape).
7. **Side ports:** UDP/TCP `:5353` held by LG `iconnectivity` (wildcard, respawn-class) → unbindable; **5335 free** and used.
8. **connmand does NOT respawn** after kill (systemd unit dead ≥2m55s; no journal files); manual `setsid` restart OK; device-local DNS gap ≈7–8 s (labeled inference); `:53` stub socket owned by connmand.
9. **cgroup/boot-hook correction:** background processes spawned from an init.d hook **survive** `startup.sh` exit (contradicts the "cgroup-killed" platform fact) — hooks run inside the persistent `/system.slice/ls-hubd.service` cgroup; PPid=1.
10. **exec-launched background processes survive**, but a long-lived child must detach stdio or the `/exec` call blocks.
11. **`elevate-service` does NOT register a new service** — it only patches an existing `services.d/<name>.service` (+ permission files); ad-hoc LS2 registration via a hand-made services.d file alone did not bring the name up (`Service does not exist`).
12. **Transport tools on G1:** curl 7.61.0 (OpenSSL 1.1.1t, nghttp2, c-ares), wget, BusyBox 1.29.3, `sha256sum`, openssl 1.0.2r (no Ed25519). curl covers raw.githubusercontent.com + GitHub release redirects; fetch → sha256 verify chain works on-device.
13. **`/exec` ceilings:** no timeout ≥120 s tested; stdout cap **204,800 B** → `returnValue:false` `"stdout maxBuffer exceeded"`, **child killed**, **luna-send rc=0** (rc unreliable); no concurrency lock; `spawn` streams but needs a bounded reader; stdoutString preserved on failure.
14. **Busybox tool gaps:** `timeout` needs `-t`; `nc` option-less (`nc -z` unusable); `netstat` has no `-p`; `ss` absent; `ps w` omits orphans; `/proc/mounts` hides bind sources (use `/proc/self/mountinfo`).
15. **`/etc` on read-only rootfs:** `sed -i` on `/etc/hosts` fails EROFS → **in-place content rewrite only**; kernel allows stacked bind mounts (app discipline must refuse on stacked).
16. **HBC hosts mount:** regenerated per boot (`/tmp/hosts` bind; identical inode); `/etc/hosts` md5 is not boot-invariant (values seen: `a151aa27…` install-time sheet, `7900d0cf…` normal boot, `4af6093d…` raw/no-HBC).
17. **`/tmp` is volatile** — power loss wipes it (lifeline file gone; re-stage after any power event).
18. **Failsafe window ≈3.5–4 min per boot** (stretched by `99-stop-services`); any power/reboot event inside → next boot = failsafe (SSH off, telnet `:23` open, hooks skipped, HBC mounts absent); recovery = one clean reboot (~26 s to SSH). Reproduced twice, once deliberately.
19. **RTC resets on cold boot** (clock back to 2021-01-01 after power loss) — no RTC persistence.
20. **IPv6:** ULA-only (`fd4d:…`) on the guest net, no global path; kernel lacks `ip6_tables` → unfilterable.
21. **DoH/443 reachable** (live proof: `snu.lge.com` resolved via DoH) — documented limit at the DNS layer.
22. **`connectionmanager/getStatus`:** `dns1` = working upstream (`192.168.179.1`); `dns2`/`dns3` = DHCPv6 ULA (not valid v4 targets); `onInternet:"no"` is untrustworthy (set while DNS/HTTPS fully functional).
23. **Signing feasible on-device:** aead/minisign v0.3.0 linux-arm64 static (1,769,624 B, sha256 `3b9bb358762f5da8eb6af8218f56fae97ec61bbdca899f43861ffde07af1dfde`) runs on G1; C-minisign prehashed + legacy signatures verified; tamper rejected; `-H` enforced.
24. **journald absent / `logread` empty** — no daemon logs on this build.
25. **`luna-send-pub -i` install subscription does not self-exit** after `installed` (install itself works via `appInstallService/dev/install`).
26. **Luna bus ACL nuance:** `applicationManager/listApps` denied on the public bus; privileged `luna-send` works.
