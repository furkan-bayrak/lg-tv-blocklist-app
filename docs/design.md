# LG TV Blocking App — Design Specification

> Status: **APPROVED** — design presented in 3 sections and approved by owner on 2026-09-14; critique-pass amendments (2026-09-14 PM) folded below, all owner-approved.
> Amendment log (grill): 2026-09-14 — **D11** (ownership & coexistence: scoped ownership / never fights; hosts = one sheet with marked sections; firewall = labeled bucket) — item 1 COMPLETE. **D12** (DNS-guard architecture: on-TV blocking filter, owner pick B; G1 validation spike before build-out; fail-open ladder, network-owned upstream, Pi-hole coexistence confirmed) — item 2 COMPLETE. **D13** (privileged execution: scripts-only via HBC bridge; fixed commands; self-verifying scripts; filter keeper with fail-open) — item 3 COMPLETE. **D14** (list updates: HTTPS-only from our repo; fingerprint-verified atomic swap; one-step-back copy; quiet auto-apply; never blocking) — item 4 COMPLETE. **D15** (honest copy + Strict-breakage UX: live counts, no absolutes; Safe default; in-app help with one-tap switch to Safe) — item 5 COMPLETE. **D16** (device floor + gates + Pro-group mapping: claim only tested; restore drill checklist; group tags repo-side) — item 6 COMPLETE. **GRILL COMPLETE (D11–D16).**
> Amendment log (**2026-09-14 PM — critique-pass fold**, owner-approved; sources: `artifacts/2026-09-14-lg-tv-app-critique-builder.md`, `artifacts/2026-09-14-lg-tv-app-critique-reviewer.md`): fail-open re-order by construction (D12/D13/§3/§6); Strict update gating + signing pricing + atomicity definition (D14); bridge contracts + service-swap trigger (D13/§3); coexistence + criteria-bound Slice 0 spike (§8); honesty fixes — IPv6 status, §9 non-goal, mockup placeholders, count semantics, bundled date, store gate, status trust (D2/D13/D15/§4/§7/§9); device floor amendment + extended restore drill + test compact (D16/§8); stack pins — TS→ES5 pinned, shell = glue only, Go filter (reuse-first), Node rejected (§3). Counts re-verified live 2026-09-14: **safe = 21; strict = 116 total**.
> This document is the handoff artifact: a fresh session for this project boots from it.
> Companion project to `furkan-bayrak/lg-tv-blocklist` (its lists feed the app). Origin: issue #11.

## 1. Problem & positioning

- Rooted LG webOS TV owners have no simple, server-free way to stop LG ads/telemetry on the TV itself. Current options: build a Pi-hole/AdGuard Home setup, or run hand-written scripts over SSH.
- **The app is a TV-local cleaner:** it installs and controls blocking on one TV. One switch + a safe/strict choice. Lists update from our repo. No server, no extra hardware, no router changes.
- **Not** a Pi-hole replacement: network-wide protection remains Pi-hole's job. For Pi-hole owners the app still adds value by guarding the TV's DNS escape routes (hardcoded resolvers / DoT).
- **Audience:** rooted LG TV owners, non-experts. Installed via the Homebrew Channel; catalog listing is the final milestone.
- **Honest limits are documented publicly**, same discipline as the repo.

## 2. Locked decisions

- **D1 — v1 scope:** install/setup from the Homebrew Channel (no SSH knowledge), on/off switch, Safe/Strict modes, list updates pulled from our repo, restore-to-normal. Store-grade foundation from day one. Everything else is a later milestone on the same app.
- **D2 — Modes map to repo tiers (counts corrected 2026-09-14 PM):** Safe = high-confidence blocks (21 entries today). Strict = the aggressive tier on top of Safe: 86 aggressive hostnames + 9 zone anchors added to Safe's 21 → **116 total today** (the old "116 more; 137 total" wording was wrong). Counts shown live from the lists (D15) — numbers drift, copy never hardcodes. *(List-repo follow-up, out of app scope: 9 of the 21 Safe entries are DECOMMISSIONED NXDOMAIN records kept for the audit record, plus 7 in Strict and 1 retired zone anchor — they still flow into the compiled lists, so live counts include dead entries; decide repo-side whether outputs/counts should exclude them.)*
- **D3 — Pro mode deferred (post-v1):** grouped per-domain fine-tune toggles + reset; deeper powers (custom domains, own list imports, advanced DNS settings) later still.
- **D4 — rugk:** co-maintainer + first test pilot; involved early so his testing shapes the design.
- **D5 — Repo & distribution:** new companion repo under `furkan-bayrak`, MIT (as pitched in #11); GitHub releases for the `.ipk`; webosbrew catalog listing = final milestone.
- **D6 — Store compliance from day one** (webosbrew 2026 rules): hook symlinked, never copied; no writes to system partitions; real-TV test evidence; AI-use disclosure.
- **D7 — Architecture A (approved):** lean web app; privileged work runs as scripts via the Homebrew Channel's service bridge. Built so an own privileged helper (option B) can be swapped in later without user-visible change.
- **D8 — UX law:** the user sees one switch and a safe/strict choice; machinery stays hidden; plain words, never jargon.
- **D9 — Updates:** lists fetched from the repo on app open + manual "Update now"; bundled snapshot fallback for offline installs; updates optional, never required.
- **D10 — Testing discipline:** our G1 first as lab (hand-built stack paused during tests, restored after); rugk's TV as clean-room; rollback drill on both. Never two managers at once, even in the lab.
- **D11 — Ownership & coexistence (grill 2026-09-14):** scoped ownership — the app creates only clearly-labeled pieces (its own marked section in the hosts overlay; its own labeled firewall bucket) and removes exactly those. It never fights existing setups: HBC update-blocking entries stay untouched; foreign hooks/rules are detected and reported calmly (one info line + hand-off guide), never deleted. On a clean TV the coexistence machinery is invisible.
- **D12 — DNS-guard architecture (grill 2026-09-14, owner pick B; fail-open re-order folded 2026-09-14 PM):** v1 centers on an on-TV blocking filter — the app runs its own small DNS filter and takes over the TV's lookup desk (placed where the system resolver sat; precedent: webos-dnscrypt-setup on webOS). Every lookup is checked against our list (blocked → nowhere; rest → normal upstream learned from the network). Firewall sneak-cut (redirect :53 to the local filter, drop :853) supplements where a firewall exists. Supersedes the §3b "configured resolver" redirect wording — that target was the leak path. Confirmed 2026-09-14: upstream = network's own resolver, auto-learned, follows network changes, no hardcoded third-party DNS; Pi-hole/AdGuard homes coexist (filter sits in front; both lists apply; no v1 setting).
  - **Fail-open everywhere — by construction (ordered steps):** (1) filter starts on a side port (e.g. 5353) and self-checks BEFORE any system change; (2) only then the system resolver is switched to the filter; (3) end-to-end verify — canary resolve + known-blocked name — before commit; (4) on ANY failure: restore the pre-recorded resolver FIRST, kill the filter second. "Worst case = protection off, TV works" is an ordering guarantee, not a hope. The G1 spike must prove the failure path, not just the happy path (filter binary deleted → TV still resolves within a defined number of seconds).
  - **Upstream re-learn:** once ConnMan is out of the DNS path, the keeper owns DHCP-change handling — poll `connectionmanager/getStatus` on a bounded interval plus on network-change signals; canary-verify the upstream; on upstream failure → restore system DNS (fail-open), never retry forever. Spike adds a router-reboot/DHCP-change test with max-outage-seconds pass criteria.
  - **Gate:** build-out gated by a criteria-bound G1 validation spike (Slice 0, §8); if validation fails → guard-only mode with honest limits.
- **D13 — Privileged-execution contract (grill 2026-09-14, owner confirmed; contracts + keeper order folded 2026-09-14 PM):** scripts-only via the HBC bridge (D7 reaffirmed, hardened):
  - (a) **Fixed-command discipline** — enumerated fixed entry points (no arguments) OR one documented argv-passing convention with quoting rules; no user input or downloaded content ever becomes part of a command; no `eval`, no sourcing of fetched files; fetched lists validated line-by-line against a strict allowlist before use — a rejected file keeps the previous version.
  - (b) Each script self-verifies (apply → verify → commit, else rollback + report). Status = one machine-readable block, delimiters `@@STATUS-BEGIN`/`@@STATUS-END`, `key=value` lines; all other output goes to stderr/log — the UI never parses un-delimited stdout.
  - (c) **Keeper order:** on filter death → restore system DNS FIRST (TV instantly works) → bounded background filter restart (~3 attempts, exponential backoff) → re-flip only after canary verification. Steady state = "protection off, TV works". No connman-restart flap loops.
  - (d) **Status trust:** status is derived from live probing at read time (filter socket alive, firewall `-C` checks, hosts-section hash) — never from a cached file; any status file is root-only.
  - **Service-swap trigger (D7 hedge, made explicit):** status fidelity <100% over N applies, or any double-apply observed → the on-device service variant becomes a v1 blocker. The own-service variant remains the documented swap-later option, gated by G1 validation evidence.
- **D14 — List updates: mechanics & policy (grill 2026-09-14; gating/signing/atomicity folded 2026-09-14 PM):** fetch only from `furkan-bayrak/lg-tv-blocklist` over HTTPS; SHA256 fingerprint check against the repo's published sums; one-step-back safety copy covering ALL layers as one version (single pointer); auto-check at most once per day on open + manual "Update now" always fetches; bundled snapshot fallback for offline installs; freshness shown as "X days old" bands (gentle hint, never blocking; updates optional); transport tool validated on G1 during the spike.
  - **Gating:** Safe updates quiet auto-apply ("Blocklists updated: <date>"); Strict changes require one-tap confirm.
  - **Signing:** the spike prices release signing — minisign-style detached signature, public key bundled in the IPK, artifacts on the repo's release assets. If adopted → becomes the D14 mechanism; if not → docs/FAQ must say honestly: "SHA256 = corruption check, not tamper-proof."
  - **"Atomic" defined:** single version pointer + ordered apply (filter config → hosts → firewall) + verify-each + journal (intent logged first, pointer flipped last). Boot script reconciles pointer-vs-live on every boot; one-step-back = one version across all layers. Spike adds a kill -9 mid-apply test with defined convergent behavior.
  - **Bundled-list date** shown distinctly as "bundled <date>" vs "updated <date>".
- **D15 — Honest copy & Strict-breakage UX (grill 2026-09-14, owner confirmed; count semantics folded 2026-09-14 PM):** live counts read from the installed lists (word "domains"; no hardcoded numbers; no safety absolutes). Counted unit = unique effective hostnames in the installed filter input (region filtering applied first); display "Safe: N · Strict: M (total)"; list date always adjacent. New users start on Safe; Strict carries the honest warning. A short in-app help screen ("Something not working?") lists known Strict trade-offs with a one-tap switch to Safe (protection stays on); the symptom list is also maintained in docs. Per-domain diagnosis remains post-v1 (fine-tune/Pro territory).
- **D16 — Device floor, gates & group mapping (grill 2026-09-14; floor amended 2026-09-14 PM):** claim only what is tested on real hardware (apps-repo rule: "Test the oldest webOS release you claim to support"; MUST name model + release tested). Catalog claim policy: **"webOS 5+ works (possible degradation: no firewall sneak-cut layer)"**; a **"verified"** tier is reserved for devices actually tested (launch fleet: G1 webOS 6 + rugk's TV). Recruiting a webOS 4/5 tester before launch = stated launch prerequisite. **rugk CONFIRMED as first tester (owner, 2026-09-14)**; device line = "rugk's LG TV (owner reports LG C5 / webOS 25 — exact model/OS recorded at test time)". 25/26 install workaround documented. Restore drill = observable command-output assertions run on both devices with a pre-install baseline captured BEFORE install (full checklist: §8). Pro-group mapping (entry → family: ads/telemetry/voice/gallery/OTA…) defined repo-side during the build; v1 ignores it.

## 3. Architecture (Approach A)

- **Frontend:** web app — HTML + TypeScript compiled to conservative JavaScript at build time (no framework, no runtime dependencies; spatial navigation for the remote). Two screens (see §4). **Stack pins:** exact TypeScript version + committed lockfile; compile target ES5; no polyfill assumptions; `async`/`await` and generators banned (or transpiled); lint against post-ES5 builtins; the built bundle is tested on the oldest claimed engine.
- **Privilege bridge:** Homebrew Channel Luna service `org.webosbrew.hbchannel.service` (`/exec`, `/spawn`, `/getConfiguration` for root state). Real apps use it with zero declared permissions (verified in recon). Contract per D13: enumerated fixed entry points (no arguments) or one documented argv convention with quoting rules; no `eval`, no sourcing of fetched files; fetched lists allowlist-validated line-by-line before use (a rejected file keeps the previous version); status block delimited `@@STATUS-BEGIN`/`@@STATUS-END` with `key=value` lines, all other output to stderr/log — never parse un-delimited stdout. Service-swap trigger: status fidelity <100% over N applies, or any double-apply observed → the service variant becomes a v1 blocker.
- **Blocking engine — scripts inside the app folder:** idempotent apply / status / rollback scripts; shell = glue only (apply/verify/rollback/status/keeper-boot), explicitly NOT the filter vehicle; shellcheck (adapted shell target) + tests with a stubbed PATH. Layers: (a) the on-TV blocking filter (D12): every lookup checked against our list; (b) domain blocking via the single managed hosts overlay; (c) firewall sneak-cut (redirect :53 to the local filter, drop :853) where a firewall exists — degrade cleanly where it doesn't. Layer efficacy is measured per-layer in Slice 0 (hosts-only vs filter-only vs combined); if hosts proves near-no-op under the proxy it is demoted in the spec to "coexistence shim, supplementary" — never presented as three equal layers. Every apply follows the D12 fail-open order (side-port self-check → resolver switch → end-to-end verify; any failure → resolver restored first, filter stopped second).
- **Filter daemon (v1):** small Go static binary delivered via the IPK. Reuse-first proviso: the spike prices `dnscrypt-proxy` (`blocked_names`) off-the-shelf against writing our own. If we write our own: miekg/dns-class library + fuzz tests, `--selftest` for verify-then-commit, armv7+arm64 build matrix, hot config reload; keeper/backoff/give-up per D13; CVE tracking owned by the project. Node-based forwarder explicitly rejected (Node 0.12–8 on target TVs, heavier, no modern TLS).
- **Boot:** one pointer in the TV's startup list (symlink, per store rules) → minimal boot script: reconcile pointer-vs-live (D14 journal); if ON, re-apply; then exit. Deliberately tiny; can never block TV startup.
- **Single-manager rule (D11):** scoped ownership, never-fight. Hosts overlay: ONE sheet with marked sections — at boot the app detects reality: extend the active sheet (HBC's, if present) with its own clearly-marked section, else create the single sheet itself; removal erases exactly the app's section. Firewall: app rules live in a labeled bucket (own chains); OFF/Restore unplug the bucket; foreign rules untouched. HBC update-blocking entries are adopted in place (shown, untouched); foreign setups get a calm notice, never a deletion (detector conditions enumerated in §8). Hosts edits always resolve the currently-mounted sheet, assert exactly one bind-mount, and refuse-and-report on stacked mounts; firewall rules live in named chains with a fixed jump position, `-C`-guarded jumps and re-create-if-missing tolerance — never assume a chain survives a foreign flush. HBC interaction timing, rewrite edge cases, mount discipline and the chain contract are Slice 0 deliverables (§8).
- **Component boundaries:** UI / scripts / config / logs are cleanly separated so the later service swap (D7) stays internal.
- **Config:** small local state (on/off, mode, list version); logs small and rolling.

## 4. User experience (approved)

**First run:** self-checking checklist (rooted ✓ / Homebrew Channel ✓ / lists reachable ✓, with plain-language hints on failure) + one button **Set up blocking** → progress → **"Protection is active."**

**Main screen (mockup; name placeholder — illustrative, the UI reads live counts (D15); no hardcoded counts anywhere in copy):**

```
  << app name >>
  ──────────────────────────────────────
  Status:  ● Active — blocking N domains
           ● Active — IPv4 only; IPv6 DNS unfiltered on this TV   (shown only when v6 is detected)
           ○ Off — TV behaves normally
           ⚠ Needs attention — [fix button]

  Blocking:      [ ON / OFF ]

  Level:         ( Safe )   ( Strict )
                 Safe:   N — highest-confidence blocks
                 Strict: M total — blocks more; may break individual features

  Blocklists:    updated YYYY-MM-DD (X days old)    [ Update now ]
                 (offline install: bundled YYYY-MM-DD)
  ──────────────────────────────────────
  Restore TV to normal (removes everything)
```

- **Off = paused, not removed.** **Restore TV to normal** = full removal, one extra confirmation.
- **Needs attention** always offers exactly one next step: re-apply, update, or restore.
- **Live counts:** counted unit = unique effective hostnames in the installed filter input (region filtering applied first), shown as "Safe: N · Strict: M (total)"; list date always adjacent; staleness as "X days old" bands; "bundled <date>" shown distinctly from "updated <date>".
- **IPv6 honesty:** the keeper detects a v6 default route / global v6 address; when present, status reads "Active — IPv4 only; IPv6 DNS unfiltered on this TV" with the SAME prominence as the Active badge — never a buried log line.
- If root was removed by a TV system update, the app says so plainly with the re-root hint.
- **Strict-breakage help (D15):** an in-app "Something not working?" screen lists the known Strict trade-offs with a one-tap switch to Safe (protection stays on); new users start on Safe; the symptom list is also kept in docs.

## 5. Behavior & flows (approved)

- **Setup:** checks root + HBC → downloads current lists (bundled fallback) → installs scripts → registers boot pointer → applies → verifies → reports.
- **Everyday:** toggle ON applies; OFF removes rules but keeps installation; mode switch re-applies with the other list. Every apply verifies and logs.
- **Boot:** tiny re-apply script runs through the pointer.
- **Updates:** lists checked on open + manual button; date shown ("bundled" vs "updated" labeled); Safe changes apply quietly, Strict changes need one-tap confirm; apply is ordered + verified + journaled (pointer flips last); re-apply only if changed.
- **App updates** (store): settings and blocking survive; app folder is replaced in place, pointer stays valid.
- **Restore/uninstall** removes everything the app ever created (scripts, pointer, rules, config).

## 6. Safety & failure handling (approved)

- Verify-then-commit, auto-rollback on failure — same discipline as the proven hooks. **Fail-open order (D12):** side-port self-check first, system change second; on any failure, restore the resolver first, stop the filter second — "protection off, TV works" by construction.
- Status is derived from live probing at read time (filter socket, firewall `-C` checks, hosts-section hash) — never from a cached file; any status file is root-only.
- Boot script minimal; worst realistic case = TV boots normally without blocking, app explains what happened.
- Recovery steps documented; failsafe awareness is part of the design constraints.
- "Needs attention" states are never dead ends.

## 7. Limits (accepted)

- Requires root + Homebrew Channel (inherent to the tool).
- Cannot block traffic that bypasses name resolution (direct-IP connections) or DoH-over-443; documented.
- Strict mode may break individual features by design; that is the mode choice's and (later) fine-tune's purpose.
- **IPv6:** where the device can't filter v6 (e.g. G1 lacks v6 firewall tables), status says "Active — IPv4 only; IPv6 DNS unfiltered on this TV" with the same prominence as the Active badge — never a buried log line.
- **Older/untested TVs:** catalog claim is "webOS 5+ works (possible degradation: no firewall sneak-cut layer)"; "verified" is reserved for tested devices (D16). Hosts-layer efficacy under the proxy is measured in Slice 0 — if it is near-no-op, the spec demotes it to "coexistence shim, supplementary" and says so, rather than implying three equal layers.

## 8. Testing & quality gates

- **Slice 0 — criteria-bound spike (the D12 gate):** every test gets written pass/fail criteria before it runs; the failure paths must be proven, not just the happy path — filter binary deleted; kill -9 mid-apply; power-cut-equivalent during apply; router reboot/DHCP change (max-outage-seconds criteria); mid-session on/off toggle under active playback; HBC toggle/failsafe-cut interaction. Failing the gate → guard-only mode with honest limits.
- **Spike deliverables:** boot-order trace on G1 (init.d hooks vs HBC's hosts bind-mount — prove which file edits the live sheet); mount-aware edit discipline (always resolve the currently-mounted hosts file; assert exactly one bind-mount; refuse-and-report on stacked mounts); firewall chain contract (named chains, fixed jump position, `-C`-guarded jumps, re-create-if-missing tolerance, never assume the chain survives a foreign flush); `/exec` ceilings measured on BOTH G1 and rugk's TV (timeout, output cap, spawn-vs-exec criteria, sentinel-file protocol for long operations); foreign-setup detector conditions enumerated (exactly what triggers the calm notice).
- **Per-layer efficacy:** hosts-only vs filter-only vs combined with the ConnMan proxy active. Decision rule: if hosts is near-no-op under the proxy, the spec demotes it to "coexistence shim, supplementary" and states it honestly — three layers are never presented as equal defense-in-depth.
- G1 lab: pause the hand-built stack during app tests; restore after; never two managers at once.
- rugk's TV (first tester CONFIRMED 2026-09-14; owner reports LG C5 / webOS 25 — exact model/OS recorded at test time): clean-room test of the modern path incl. the 25/26 install workaround (the stranger experience). Test compact: baseline snapshot; restore drill runs BEFORE any blocking tests; agreed time windows + his veto; log/data handling stated up front.
- **Rollback drill on both devices:** install → block → verify → restore → pass/fail checklist, every item an observable command-output assertion (not "looks normal"): resolv.conf bind-mount state restored; `connmand` dnsproxy flags restored; `/tmp/hosts` byte-compared to HBC-only content; named iptables chains DELETED (not just flushed) and jumps removed; keeper process AND its boot entry gone; post-restore DHCP renewal proof; HBC `blockUpdates` untouched; failsafe flag unset; streaming apps working; clean reboot. Pre-install baseline captured BEFORE install (hosts-content hashes, `iptables -S` dump, `ps` snapshot, connman flags).
- **Store-listing gate:** symlinked hook, no system-area writes, real-TV test evidence captured, AI disclosure included. Check: title ≤ 30 chars; category set; `rootRequired` in the manifest (not the YAML); `ipk-verify` run — and note the 25/26 workaround proves sideload, not catalog listing.

## 9. Explicit non-goals (v1)

- Pro mode / fine-tune, service trimming, statistics/dashboards, custom lists, **no authoritative DNS / statistics engine** (the on-TV blocking filter is v1 core — D12). (Later options, on the same app, in that rough order.)
- Network-wide protection (different product — that is Pi-hole's job).
- Catalog listing itself (final milestone, after v1 survives real users).

## 10. Platform facts & evidence

Full detail: `C:\wezterm_temp\opencode\app-recon-2026-09-14.md`. Key points: HBC bridge endpoints + zero-permission usage verified across real app manifests; plain HTML/JS stack common; `ares-package` + `dev-toolbox-cli` manifest + apps-repo YAML (rootRequired: true supported); closest precedent is the (rule-prohibited-style) LG App Update Blocker; **no existing app toggles an on-device DNS blocklist — genuine gap**; init.d + run-parts confirmed; hosts single-writer coordination needed; iptables present on webOS 6 G1, reported missing on some older TVs → fallback; failsafe window documented.

## 11. Open items for planning (grill / PRD fodder)

- App name, branding, app id; icon design.
- Exact list-update policy wording and offline behavior messaging (signing decision = Slice 0 outcome).
- Status labels + error-message catalog (plain language; count semantics pinned in D15).
- webOS 4/5 tester recruitment before launch (moves devices from "works" to "verified"); test-evidence format for both devices.
- HBC hosts-coordination edge cases + firewall chain contract — Slice 0 deliverables (§8); iptables-missing UX wording.
- Pointer cleanup on uninstall; dev-mode vs rooted requirements for development.
- Group mapping file for the future Pro mode (repo side; relates to the #10 tagged-file pattern).

## 12. Process & handoff

- Next pipeline steps: PRD → task slicing → implementation plans, in a **fresh session** dedicated to this project (this session remains the GitHub repo / ops home). Slice 0 in the task graph = the criteria-bound validation spike (D12/§8); filter-dependent work is marked blocked-on-spike.
- The companion repo is created at build kickoff; this document gets carried there.
- Issue #11: reply is revised to match this design, user-approved before posting, then closed.
